import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { anonymizeCandidateRecord, hardDeleteCandidateRecord } from "@/lib/services/candidates";
import type {
  DataErasureRequestCreateInput,
  DataErasureRequestDecideInput,
  DataErasureRequestQuery,
} from "@/lib/validations/data-erasure";

/**
 * Deciding an erasure request is an org-wide compliance decision, not a
 * per-record one — gated at ALL scope specifically (mirroring
 * assertAllScopeUpdate in src/lib/services/approvals.ts), not just any
 * CANDIDATE:APPROVE grant. No seeded role currently holds it, the same
 * "super-admin only in practice" shape Organization settings/
 * ApprovalStepConfig already document.
 */
async function assertAllScopeApprove(context: SessionContext) {
  const scope = await getEffectiveScope(context, ENTITY.CANDIDATE, "APPROVE");
  if (scope !== "ALL") {
    throw new ForbiddenError();
  }
}

/** Requesting needs no more privilege than hard-deleting the same candidate outright already required. */
export async function requestCandidateErasure(
  context: SessionContext,
  candidateId: string,
  input: DataErasureRequestCreateInput,
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  if (!(await can(context, ENTITY.CANDIDATE, "DELETE", { ownerId: candidate.createdById }))) {
    throw new ForbiddenError();
  }
  if (candidate.anonymizedAt) {
    throw new ConflictError("This candidate has already been anonymized.");
  }

  const existingPending = await prisma.dataErasureRequest.findFirst({
    where: { candidateId, status: "PENDING" },
  });
  if (existingPending) {
    throw new ConflictError("An erasure request for this candidate is already pending.");
  }

  const created = await prisma.dataErasureRequest.create({
    data: {
      candidateId,
      method: input.method,
      reason: input.reason,
      requestedById: context.userId,
    },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_ERASURE_REQUESTED,
    entityType: ENTITY.DATA_ERASURE_REQUEST,
    entityId: created.id,
    changes: { after: { candidateId, method: created.method, reason: created.reason } },
  });

  return created;
}

export async function listCandidateErasureRequests(context: SessionContext, query: DataErasureRequestQuery) {
  await assertAllScopeApprove(context);

  const where = query.status ? { status: query.status } : {};

  const [requests, total] = await Promise.all([
    prisma.dataErasureRequest.findMany({
      where,
      include: {
        candidate: { select: { id: true, name: true, phone: true, anonymizedAt: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.dataErasureRequest.count({ where }),
  ]);

  return { requests, total, page: query.page, pageSize: query.pageSize };
}

export async function decideCandidateErasureRequest(
  context: SessionContext,
  requestId: string,
  input: DataErasureRequestDecideInput,
) {
  await assertAllScopeApprove(context);

  const request = await prisma.dataErasureRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    throw new NotFoundError("Erasure request not found.");
  }
  if (request.status !== "PENDING") {
    throw new ConflictError("This erasure request has already been decided.");
  }
  // candidateId only ever goes null via this same decision's own
  // HARD_DELETE branch below (onDelete: SetNull) — a PENDING row always
  // still has one. Guarded explicitly rather than asserted, since the type
  // is nullable at the schema level.
  if (!request.candidateId) {
    throw new NotFoundError("Candidate not found.");
  }
  const candidateId = request.candidateId;

  if (input.decision === "REJECT") {
    const rejected = await prisma.dataErasureRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", decidedById: context.userId, decidedAt: new Date(), decisionNotes: input.decisionNotes },
    });

    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.CANDIDATE_ERASURE_DECIDED,
      entityType: ENTITY.DATA_ERASURE_REQUEST,
      entityId: requestId,
      changes: { before: { status: "PENDING" }, after: { status: "REJECTED", decisionNotes: input.decisionNotes } },
    });

    return rejected;
  }

  if (request.method === "ANONYMIZE") {
    await anonymizeCandidateRecord(candidateId);
    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.CANDIDATE_ANONYMIZED,
      entityType: ENTITY.CANDIDATE,
      entityId: candidateId,
      changes: { after: { anonymizedAt: new Date().toISOString(), viaRequestId: requestId } },
    });
  } else {
    const deleted = await hardDeleteCandidateRecord(candidateId);
    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.CANDIDATE_DELETED,
      entityType: ENTITY.CANDIDATE,
      entityId: candidateId,
      changes: { before: deleted, after: { viaRequestId: requestId } },
    });
  }

  const approved = await prisma.dataErasureRequest.update({
    where: { id: requestId },
    data: { status: "COMPLETED", decidedById: context.userId, decidedAt: new Date(), decisionNotes: input.decisionNotes },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_ERASURE_DECIDED,
    entityType: ENTITY.DATA_ERASURE_REQUEST,
    entityId: requestId,
    changes: { before: { status: "PENDING" }, after: { status: "COMPLETED", decisionNotes: input.decisionNotes } },
  });

  return approved;
}

/**
 * §13's "retention limits" — a policy-driven sweep needs no per-candidate
 * human sign-off (that's the point of a limit vs. a request queue), so this
 * always ANONYMIZE (never HARD_DELETE — too destructive for an unattended
 * process) and always completes immediately, recording a DataErasureRequest
 * row with requestedById: null purely so every erasure — staff-requested or
 * automatic — shows up in the one queue/history, not two.
 *
 * Skips a candidate with any ACTIVE (non-terminal) Application — sweeping
 * PII out from under someone still actively progressing through a pipeline
 * would be a functional regression, not a compliance feature. Idempotent:
 * re-running only ever matches candidates with anonymizedAt: null, and this
 * function itself sets that field, so a candidate anonymized by one run
 * simply drops out of a later run's own WHERE clause — the same
 * "idempotency falls out of the terminal-state transition" shape
 * runDueOfferExpirations already establishes, not a claim-slot state
 * machine.
 */
export async function runDueRetentionSweeps(
  now: Date = new Date(),
): Promise<{ evaluatedCount: number; anonymizedCount: number }> {
  const organization = await prisma.organization.findFirst();
  if (!organization?.candidateRetentionDays) {
    return { evaluatedCount: 0, anonymizedCount: 0 };
  }

  const cutoff = new Date(now.getTime() - organization.candidateRetentionDays * 24 * 60 * 60 * 1000);

  const dueCandidates = await prisma.candidate.findMany({
    where: {
      anonymizedAt: null,
      createdAt: { lte: cutoff },
      applications: { none: { outcome: "ACTIVE" } },
    },
    select: { id: true },
  });

  let anonymizedCount = 0;
  for (const candidate of dueCandidates) {
    // Re-check anonymizedAt is still null immediately before acting — a
    // concurrent sweep or a manually-decided erasure request could have
    // already anonymized this row between the query above and this loop
    // iteration; anonymizeCandidateRecord itself has no guard against
    // double-running, so the check belongs here, at the call site.
    const fresh = await prisma.candidate.findUnique({ where: { id: candidate.id }, select: { anonymizedAt: true } });
    if (fresh?.anonymizedAt) continue;

    await anonymizeCandidateRecord(candidate.id);

    const request = await prisma.dataErasureRequest.create({
      data: {
        candidateId: candidate.id,
        method: "ANONYMIZE",
        status: "COMPLETED",
        reason: `Automatic retention sweep — candidate exceeded the organization's ${organization.candidateRetentionDays}-day retention limit.`,
        decidedAt: now,
      },
    });

    await recordAudit({
      actorId: null,
      action: AUDIT_ACTIONS.CANDIDATE_ANONYMIZED,
      entityType: ENTITY.CANDIDATE,
      entityId: candidate.id,
      changes: { after: { anonymizedAt: now.toISOString(), viaRequestId: request.id, reason: "retention_sweep" } },
    });

    anonymizedCount += 1;
  }

  return { evaluatedCount: dueCandidates.length, anonymizedCount };
}
