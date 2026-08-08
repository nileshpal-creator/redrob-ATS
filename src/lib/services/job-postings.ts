import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, DuplicateCandidateError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { getJobBoardProvider } from "@/lib/job-boards";
import { addCandidateNote, createCandidate } from "@/lib/services/candidates";
import { createApplication } from "@/lib/services/applications";
import type { InboundApplicationInput, JobPostingCreateInput } from "@/lib/validations/job-posting";

const userSummarySelect = { id: true, name: true, email: true } as const;

const jobPostingInclude = {
  job: { select: { id: true, title: true } },
  source: { select: { id: true, label: true } },
  postedBy: { select: userSummarySelect },
} satisfies Prisma.JobPostingInclude;

type JobOwnership = { id: string; primaryRecruiterId: string; status: string; title: string; description: string | null };

/**
 * Managing a job's board postings is authorized as JOB:<action> on the
 * parent job, not a separate resource — the same reuse PipelineStage's own
 * configuration already establishes (see pipeline-stages.ts's own comment).
 * Deliberately its own small copy rather than an import from jobs.ts/
 * pipeline-stages.ts, matching this codebase's existing convention (each
 * service file that needs it — jobs.ts, candidates.ts, applications.ts,
 * interviews.ts, offers.ts, pipeline-stages.ts — keeps its own).
 */
async function assertJobAccess(context: SessionContext, job: { primaryRecruiterId: string }, action: PermissionAction) {
  if (await can(context, ENTITY.JOB, action)) return;
  if (await can(context, ENTITY.JOB, action, { ownerId: job.primaryRecruiterId })) return;
  throw new ForbiddenError();
}

async function assertControlledListValue(listKey: string, valueId: string, fieldLabel: string) {
  const value = await prisma.controlledListValue.findUnique({ where: { id: valueId }, include: { list: true } });
  if (!value || !value.isActive || value.list.key !== listKey) {
    throw new ValidationError(`Invalid ${fieldLabel}.`);
  }
}

async function getJobForPostingAccess(jobId: string): Promise<JobOwnership> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, primaryRecruiterId: true, status: true, title: true, description: true },
  });
  if (!job) {
    throw new NotFoundError("Job not found.");
  }
  return job;
}

async function getJobPostingForAccess(id: string) {
  const posting = await prisma.jobPosting.findUnique({
    where: { id },
    include: { job: { select: { id: true, primaryRecruiterId: true, status: true, title: true, description: true } } },
  });
  if (!posting) {
    throw new NotFoundError("Job posting not found.");
  }
  return posting;
}

export async function listJobPostings(context: SessionContext, jobId: string) {
  const job = await getJobForPostingAccess(jobId);
  await assertJobAccess(context, job, "READ");

  return prisma.jobPosting.findMany({
    where: { jobId },
    include: jobPostingInclude,
    orderBy: { postedAt: "desc" },
  });
}

/**
 * "Post a job to major job boards from a single requisition" (§11.3). One
 * `JobPosting` row persists per (job, board) — re-posting after a removal
 * re-activates the same row (see the model comment in schema.prisma) rather
 * than creating a second one; `@@unique([jobId, sourceId])` is what makes a
 * genuine double-post (two concurrent requests, no existing row yet)
 * resolve to a clean error instead of a duplicate row or an unhandled 500.
 *
 * A provider failure does not throw — the posting is still recorded, with
 * status FAILED and the provider's own errorMessage, so the caller can see
 * why and retry (the same "the record persists so it can be retried" shape
 * HandoffRecord/HandoffDeliveryAttempt already use for delivery failures).
 */
export async function createJobPosting(context: SessionContext, jobId: string, input: JobPostingCreateInput) {
  const job = await getJobForPostingAccess(jobId);
  await assertJobAccess(context, job, "UPDATE");

  if (job.status !== "OPEN") {
    throw new ValidationError("Only an OPEN job can be posted to a board.");
  }
  await assertControlledListValue("CANDIDATE_SOURCE", input.sourceId, "board");

  const existing = await prisma.jobPosting.findUnique({ where: { jobId_sourceId: { jobId, sourceId: input.sourceId } } });
  if (existing?.status === "POSTED") {
    throw new ValidationError("This job is already posted to that board.");
  }

  const provider = getJobBoardProvider();
  const result = await provider.post({ jobId: job.id, title: job.title, description: job.description });

  const data = {
    status: result.success ? ("POSTED" as const) : ("FAILED" as const),
    externalPostingId: result.externalPostingId,
    errorMessage: result.errorMessage,
    postedById: context.userId,
    postedAt: new Date(),
    removedAt: null,
  };

  let posting;
  if (existing) {
    // Status-guarded, same shape removeJobPosting uses — the only "conflict" that
    // matters when reactivating an existing row is "did someone else already
    // repost/change it," fully captured by status (not POSTED, checked above).
    const updateResult = await prisma.jobPosting.updateMany({
      where: { id: existing.id, status: { not: "POSTED" } },
      data,
    });
    if (updateResult.count === 0) {
      throw new ConflictError("This posting was already changed by someone else. Reload and try again.");
    }
    posting = await prisma.jobPosting.findUniqueOrThrow({ where: { id: existing.id }, include: jobPostingInclude });
  } else {
    posting = await prisma.jobPosting
      .create({ data: { jobId, sourceId: input.sourceId, ...data }, include: jobPostingInclude })
      .catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          throw new ConflictError("This job is already being posted to that board. Reload and try again.");
        }
        throw error;
      });
  }

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_POSTING_CREATED,
    entityType: ENTITY.JOB,
    entityId: jobId,
    changes: { after: { sourceId: input.sourceId, status: posting.status, errorMessage: posting.errorMessage } },
  });

  return posting;
}

/**
 * Status-guarded `updateMany` (WHERE id AND status = 'POSTED') is the
 * concurrency guard here, the same lightweight shape WorkflowTask uses in
 * place of a dedicated `version` column — the only "conflict" that matters
 * is "did someone else already remove this," fully captured by status.
 */
export async function removeJobPosting(context: SessionContext, id: string) {
  const posting = await getJobPostingForAccess(id);
  await assertJobAccess(context, posting.job, "UPDATE");

  if (posting.status !== "POSTED") {
    throw new ValidationError("This posting is not currently active.");
  }

  const provider = getJobBoardProvider();
  const result = posting.externalPostingId ? await provider.remove(posting.externalPostingId) : { success: true };
  if (!result.success) {
    throw new ValidationError(result.errorMessage ?? "Failed to remove this posting.");
  }

  const updateResult = await prisma.jobPosting.updateMany({
    where: { id, status: "POSTED" },
    data: { status: "REMOVED", removedAt: new Date() },
  });
  if (updateResult.count === 0) {
    throw new ConflictError("This posting was already changed by someone else. Reload and try again.");
  }

  const updated = await prisma.jobPosting.findUniqueOrThrow({ where: { id }, include: jobPostingInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_POSTING_REMOVED,
    entityType: ENTITY.JOB,
    entityId: posting.jobId,
    changes: { before: { status: "POSTED" }, after: { status: "REMOVED" } },
  });

  return updated;
}

/**
 * "Inbound applications land directly in the correct pipeline with source
 * tagged automatically" (§11.3) — a staff member records what a board
 * notified them about (name/phone/email); the system decides the candidate
 * and application, not the recruiter. "Automatic" refers to that tagging
 * logic, not the transport: there is no real board credential in this
 * environment to receive a live webhook from, and this app has no
 * unauthenticated route class to receive one on — every route requires a
 * session (see docs/api.md). A future real board integration's own webhook
 * handler or polling adapter would call this exact function.
 *
 * A phone match reuses the existing Candidate and never touches its
 * existing sourceId (Candidate is "held once globally", §9) — an inbound
 * application through a *different* board than a returning candidate's
 * original one must not overwrite their original attribution. Duplicate
 * re-application handling is inherited entirely from createApplication's
 * own existing warn-never-block behavior (§11.4) — no new idempotency
 * mechanism invented here.
 */
export async function receiveInboundApplication(context: SessionContext, jobPostingId: string, input: InboundApplicationInput) {
  const posting = await getJobPostingForAccess(jobPostingId);
  await assertJobAccess(context, posting.job, "UPDATE");

  if (posting.status !== "POSTED") {
    throw new ValidationError("This posting is not active — reactivate it before recording inbound applications.");
  }

  let candidate;
  try {
    candidate = await createCandidate(context, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      sourceId: posting.sourceId,
      consentGivenAt: new Date(),
      skills: [],
      tags: [],
    });
  } catch (error) {
    if (error instanceof DuplicateCandidateError) {
      candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: error.existingCandidateId } });
    } else {
      throw error;
    }
  }

  const application = await createApplication(
    context,
    { candidateId: candidate.id, jobId: posting.jobId },
    { sourcedFromPostingId: posting.id },
  );

  if (input.note) {
    await addCandidateNote(context, candidate.id, { body: `Inbound application note: ${input.note}` });
  }

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_POSTING_INBOUND_APPLICATION_RECEIVED,
    entityType: ENTITY.APPLICATION,
    entityId: application.id,
    changes: { after: { jobPostingId, candidateId: candidate.id } },
  });

  return application;
}
