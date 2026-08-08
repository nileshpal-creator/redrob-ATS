import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { HandoffStatus, PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getFieldAccess, getTeamMemberIds } from "@/lib/authz/authorize";
import { sanitizeForRead, sanitizeManyForRead } from "@/lib/authz/field-sanitizer";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { getHrisProvider } from "@/lib/hris";
import type { HandoffPayload } from "@/lib/hris";
import type { HandoffAcknowledgeInput, HandoffQuery, HandoffRetryInput } from "@/lib/validations/handoff";

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

const userSummarySelect = { id: true, name: true, email: true } as const;

const handoffListInclude = {
  application: {
    select: {
      id: true,
      candidate: { select: { id: true, name: true } },
      job: { select: { id: true, title: true } },
    },
  },
  offer: { select: { id: true, compensation: true, expectedJoiningDate: true } },
  initiatedBy: { select: userSummarySelect },
  acknowledgedBy: { select: userSummarySelect },
} satisfies Prisma.HandoffRecordInclude;

const handoffDetailInclude = {
  ...handoffListInclude,
  attempts: {
    orderBy: { attemptedAt: "desc" },
    include: { attemptedBy: { select: userSummarySelect } },
  },
} satisfies Prisma.HandoffRecordInclude;

type HandoffOwnership = { initiatedById: string };

/**
 * Handoff has one ownership facet — whoever accepted the Offer that
 * triggered it (HandoffRecord.initiatedById) — same single-function shape as
 * assertOfferAccess, covering READ/UPDATE(retry)/APPROVE(acknowledge) alike:
 * the PRD models HR/Onboarding's acknowledgement as an ALL-scope grant
 * (prisma/seed.ts), not a per-handoff assigned reviewer.
 */
async function assertHandoffAccess(context: SessionContext, handoff: HandoffOwnership, action: PermissionAction) {
  if (await can(context, ENTITY.HANDOFF, action)) return;
  if (await can(context, ENTITY.HANDOFF, action, { ownerId: handoff.initiatedById })) return;
  throw new ForbiddenError();
}

/**
 * Sole source of truth for "is this application archived by a completed
 * handoff" — no new field on Application itself (see the HandoffRecord
 * model comment in schema.prisma). Called from transitionApplication
 * (applications.ts), scheduleInterview (interviews.ts), and createOffer
 * (offers.ts) so a hired-and-handed-off candidate's application can't
 * collect a new interview/offer or be re-staged/rejected/withdrawn. Reads
 * outside any transaction, same "best-effort pre-check, not a hard
 * constraint" acceptance as the outcome !== "ACTIVE" checks it sits next to
 * at every call site — this guards a business rule, not data integrity, so
 * no unique index backs it.
 */
export async function assertApplicationNotHandedOff(applicationId: string) {
  const acceptedHandoff = await prisma.handoffRecord.findFirst({
    where: { applicationId, status: "ACCEPTED" },
    select: { id: true },
  });
  if (acceptedHandoff) {
    throw new ValidationError("This application has completed onboarding handoff and is now read-only.");
  }
}

/**
 * Candidate is a shared, global record (§9: "held once globally") that can
 * legitimately be in more than one pipeline at once, unlike Application —
 * so this cannot simply mirror assertApplicationNotHandedOff by locking the
 * whole Candidate the instant *any one* of their applications is handed
 * off; that would incorrectly freeze a candidate's profile while a
 * recruiter is still actively working a *different* open application for
 * the same person. The read-only rule instead applies only once there is no
 * legitimate reason left to edit the profile: every application this
 * candidate has is either terminal (REJECTED/WITHDRAWN) or itself already
 * handed off, and at least one of those handed-off applications has
 * actually completed (status ACCEPTED, not merely DELIVERED/pending
 * acknowledgement). A candidate with zero applications, or with at least
 * one still-ACTIVE application that isn't handed off, is never locked here.
 */
export async function assertCandidateNotHandedOff(candidateId: string) {
  const applications = await prisma.application.findMany({
    where: { candidateId },
    select: { id: true, outcome: true },
  });
  if (applications.length === 0) {
    return;
  }

  const acceptedHandoffs = await prisma.handoffRecord.findMany({
    where: { applicationId: { in: applications.map((application) => application.id) }, status: "ACCEPTED" },
    select: { applicationId: true },
  });
  if (acceptedHandoffs.length === 0) {
    return;
  }
  const handedOffApplicationIds = new Set(acceptedHandoffs.map((handoff) => handoff.applicationId));

  const hasOpenApplicationElsewhere = applications.some(
    (application) => application.outcome === "ACTIVE" && !handedOffApplicationIds.has(application.id),
  );
  if (hasOpenApplicationElsewhere) {
    return;
  }

  throw new ValidationError(
    "This candidate has completed onboarding handoff for every active application and is now read-only.",
  );
}

/**
 * Assembled once, at handoff creation, from whatever tx is creating the
 * HandoffRecord — never re-read live afterward (see the model comment on
 * HandoffRecord.payload in schema.prisma). Documents are the candidate's
 * full set, not filtered by document type label: DOCUMENT_TYPE is an
 * admin-editable Controlled List, and matching against its label text would
 * silently drop documents on a rename — a complete manifest is also simply
 * more useful to HR/HRIS than a guessed subset.
 */
async function buildHandoffPayload(client: PrismaClientOrTx, offerId: string): Promise<HandoffPayload> {
  const offer = await client.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: {
      application: {
        include: {
          candidate: { include: { documents: { include: { documentType: true } } } },
          job: { select: { id: true, title: true } },
        },
      },
    },
  });

  const { candidate, job } = offer.application;

  return {
    candidate: {
      id: candidate.id,
      name: candidate.name,
      phone: candidate.phone,
      email: candidate.email,
      location: candidate.location,
      currentCompensation: candidate.currentCompensation?.toString() ?? null,
      expectedCompensation: candidate.expectedCompensation?.toString() ?? null,
      earliestAvailability: candidate.earliestAvailability?.toISOString() ?? null,
    },
    offer: {
      id: offer.id,
      compensation: offer.compensation.toString(),
      expectedJoiningDate: offer.expectedJoiningDate?.toISOString() ?? null,
      notes: offer.notes,
    },
    job: { id: job.id, title: job.title },
    documents: candidate.documents.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      documentType: doc.documentType.label,
      uploadedAt: doc.uploadedAt.toISOString(),
    })),
  };
}

/**
 * Called from within transitionOffer's own $transaction (src/lib/services/offers.ts)
 * on an ACCEPT transition — direct service-to-service call, no event bus,
 * same convention as seedDefaultPipelineStages being called from createJob.
 * Attempts delivery synchronously as part of the same transaction: the only
 * implemented provider (StructuredExportProvider) does no real network I/O,
 * so there is no "long-running side effect inside a DB transaction" concern
 * here the way there would be for a real HRIS API call. The caller is
 * responsible for the HANDOFF_INITIATED audit entry once its own transaction
 * has committed (same "audit after commit" convention as OFFER_STATUS_CHANGED).
 */
export async function createHandoffForOffer(
  tx: Prisma.TransactionClient,
  context: SessionContext,
  offerId: string,
  applicationId: string,
) {
  const payload = await buildHandoffPayload(tx, offerId);
  const provider = getHrisProvider();
  const result = await provider.push(payload);

  const handoff = await tx.handoffRecord.create({
    data: {
      offerId,
      applicationId,
      deliveryMethod: provider.method,
      payload: payload as Prisma.InputJsonValue,
      status: result.success ? "DELIVERED" : "EXCEPTION",
      externalReferenceId: result.externalReferenceId,
      exceptionReason: result.success ? null : result.errorMessage,
      initiatedById: context.userId,
    },
  });

  await tx.handoffDeliveryAttempt.create({
    data: {
      handoffRecordId: handoff.id,
      deliveryMethod: provider.method,
      succeeded: result.success,
      externalReferenceId: result.externalReferenceId,
      errorMessage: result.errorMessage,
      attemptedById: context.userId,
    },
  });

  return handoff;
}

export async function listHandoffs(context: SessionContext, query: HandoffQuery) {
  const scope = await getEffectiveScope(context, ENTITY.HANDOFF, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.HandoffRecordWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { initiatedById: context.userId };
  } else if (scope === "TEAM") {
    const teamIds = await getTeamMemberIds(context.userId);
    ownerFilter = { initiatedById: { in: teamIds } };
  }

  const where: Prisma.HandoffRecordWhereInput = {
    ...ownerFilter,
    applicationId: query.applicationId,
    status: query.status,
  };

  const [handoffs, total, fieldAccess] = await Promise.all([
    prisma.handoffRecord.findMany({
      where,
      include: handoffDetailInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.handoffRecord.count({ where }),
    getFieldAccess(context, ENTITY.HANDOFF),
  ]);

  return {
    handoffs: sanitizeManyForRead(handoffs, fieldAccess),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getHandoff(context: SessionContext, id: string) {
  const handoff = await prisma.handoffRecord.findUnique({ where: { id }, include: handoffDetailInclude });
  if (!handoff) {
    throw new NotFoundError("Handoff not found.");
  }
  await assertHandoffAccess(context, handoff, "READ");
  const fieldAccess = await getFieldAccess(context, ENTITY.HANDOFF);
  return sanitizeForRead(handoff, fieldAccess);
}

/**
 * Re-pushes the frozen payload captured at creation — retry re-attempts
 * delivery of what was originally assembled, it does not re-snapshot the
 * candidate/offer, matching the "payload is a snapshot" design.
 */
export async function retryHandoff(context: SessionContext, id: string, input: HandoffRetryInput) {
  const existing = await prisma.handoffRecord.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Handoff not found.");
  }
  await assertHandoffAccess(context, existing, "UPDATE");

  if (existing.status !== "EXCEPTION") {
    throw new ValidationError(`This handoff is ${existing.status.toLowerCase()} and cannot be retried.`);
  }

  const provider = getHrisProvider();
  const result = await provider.push(existing.payload as unknown as HandoffPayload);
  const nextStatus: HandoffStatus = result.success ? "DELIVERED" : "EXCEPTION";

  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.handoffRecord.updateMany({
      where: { id, version: input.version },
      data: {
        status: nextStatus,
        externalReferenceId: result.externalReferenceId,
        exceptionReason: result.success ? null : result.errorMessage,
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      throw new ConflictError("This handoff was changed by someone else. Reload and try again.");
    }

    await tx.handoffDeliveryAttempt.create({
      data: {
        handoffRecordId: id,
        deliveryMethod: provider.method,
        succeeded: result.success,
        externalReferenceId: result.externalReferenceId,
        errorMessage: result.errorMessage,
        attemptedById: context.userId,
      },
    });

    return tx.handoffRecord.findUniqueOrThrow({ where: { id }, include: handoffDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.HANDOFF_STATUS_CHANGED,
    entityType: ENTITY.HANDOFF,
    entityId: id,
    changes: { before: { status: existing.status }, after: { status: nextStatus } },
  });

  const fieldAccess = await getFieldAccess(context, ENTITY.HANDOFF);
  return sanitizeForRead(updated, fieldAccess);
}

/**
 * HR/Onboarding's confirmation that the package was received — gated on
 * DELIVERED (not PENDING/EXCEPTION): there is nothing to acknowledge until a
 * delivery attempt has actually succeeded. Setting status to ACCEPTED here
 * is what makes assertApplicationNotHandedOff start rejecting further
 * mutations on the linked Application — the archive/read-only behaviour has
 * no separate flag or endpoint.
 */
export async function acknowledgeHandoff(context: SessionContext, id: string, input: HandoffAcknowledgeInput) {
  const existing = await prisma.handoffRecord.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Handoff not found.");
  }
  await assertHandoffAccess(context, existing, "APPROVE");

  if (existing.status !== "DELIVERED") {
    throw new ValidationError(`This handoff is ${existing.status.toLowerCase()} and cannot be acknowledged.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.handoffRecord.updateMany({
      where: { id, version: input.version },
      data: {
        status: input.outcome,
        exceptionReason: input.outcome === "EXCEPTION" ? input.exceptionReason : null,
        acknowledgedById: context.userId,
        acknowledgedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      throw new ConflictError("This handoff was changed by someone else. Reload and try again.");
    }
    return tx.handoffRecord.findUniqueOrThrow({ where: { id }, include: handoffDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.HANDOFF_STATUS_CHANGED,
    entityType: ENTITY.HANDOFF,
    entityId: id,
    changes: { before: { status: existing.status }, after: { status: input.outcome } },
  });

  const fieldAccess = await getFieldAccess(context, ENTITY.HANDOFF);
  return sanitizeForRead(updated, fieldAccess);
}
