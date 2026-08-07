import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, DuplicateCandidateError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { buildCustomFieldValueSchema } from "@/lib/custom-fields/dynamic-schema";
import { getStorageProvider } from "@/lib/storage";
import type {
  CandidateCreateInput,
  CandidateDuplicateCheckInput,
  CandidateMergeInput,
  CandidateNoteInput,
  CandidateQuery,
  CandidateUpdateInput,
} from "@/lib/validations/candidate";

const userSummarySelect = { id: true, name: true, email: true } as const;

const candidateListInclude = {
  source: true,
} satisfies Prisma.CandidateInclude;

const candidateDetailInclude = {
  ...candidateListInclude,
  createdBy: { select: userSummarySelect },
  documents: { include: { documentType: true, uploadedBy: { select: userSummarySelect } } },
  notes: { orderBy: { createdAt: "desc" }, include: { author: { select: userSummarySelect } } },
} satisfies Prisma.CandidateInclude;

type CandidateOwnership = { createdById: string };

async function assertControlledListValue(listKey: string, valueId: string, fieldLabel: string) {
  const value = await prisma.controlledListValue.findUnique({
    where: { id: valueId },
    include: { list: true },
  });
  if (!value || !value.isActive || value.list.key !== listKey) {
    throw new ValidationError(`Invalid ${fieldLabel}.`);
  }
}

async function validateCandidateCustomFields(customFields: Record<string, unknown> | undefined) {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: ENTITY.CANDIDATE, isActive: true },
  });
  if (definitions.length === 0) {
    return {};
  }
  return buildCustomFieldValueSchema(definitions).parse(customFields ?? {});
}

/**
 * §9's Candidate has no "assigned recruiter" concept the way Job does (that
 * only exists once the Application entity exists, in a future module), so
 * OWN/TEAM ownership resolves against whoever created the record instead —
 * the Phase 1 decision.
 */
async function assertCandidateAccess(
  context: SessionContext,
  candidate: CandidateOwnership,
  action: PermissionAction,
) {
  if (await can(context, ENTITY.CANDIDATE, action)) return;
  if (await can(context, ENTITY.CANDIDATE, action, { ownerId: candidate.createdById })) return;
  throw new ForbiddenError();
}

async function buildScopedWhere(
  context: SessionContext,
  query: Pick<
    CandidateQuery,
    | "q"
    | "skills"
    | "tags"
    | "location"
    | "sourceId"
    | "noticePeriodMaxDays"
    | "experienceMinYears"
    | "experienceMaxYears"
    | "compensationMaxExpected"
  >,
): Promise<Prisma.CandidateWhereInput> {
  const scope = await getEffectiveScope(context, ENTITY.CANDIDATE, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.CandidateWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { createdById: context.userId };
  } else if (scope === "TEAM") {
    const teamIds = await getTeamMemberIds(context.userId);
    ownerFilter = { createdById: { in: teamIds } };
  }

  return {
    ...ownerFilter,
    sourceId: query.sourceId,
    ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
    ...(query.skills?.length ? { skills: { hasSome: query.skills } } : {}),
    ...(query.tags?.length ? { tags: { hasSome: query.tags } } : {}),
    ...(query.noticePeriodMaxDays !== undefined
      ? { noticePeriodDays: { lte: query.noticePeriodMaxDays } }
      : {}),
    ...(query.experienceMinYears !== undefined || query.experienceMaxYears !== undefined
      ? {
          totalExperienceYears: {
            gte: query.experienceMinYears,
            lte: query.experienceMaxYears,
          },
        }
      : {}),
    ...(query.compensationMaxExpected !== undefined
      ? { expectedCompensation: { lte: query.compensationMaxExpected } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { phone: { contains: query.q } },
            { email: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listCandidates(context: SessionContext, query: CandidateQuery) {
  const where = await buildScopedWhere(context, query);

  const [candidates, total] = await Promise.all([
    prisma.candidate.findMany({
      where,
      include: candidateListInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.candidate.count({ where }),
  ]);

  return { candidates, total, page: query.page, pageSize: query.pageSize };
}

export async function getCandidateById(context: SessionContext, id: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id }, include: candidateDetailInclude });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "READ");
  return candidate;
}

/**
 * Pre-flight check for the create form / import flow — never mutates
 * anything. Uses getEffectiveScope, not requirePermission: this isn't
 * checked against any one record's ownership, so a plain OWN-scope grant
 * (the common Recruiter case) must still pass, exactly like listCandidates.
 */
export async function checkCandidateDuplicates(
  context: SessionContext,
  input: CandidateDuplicateCheckInput,
) {
  const scope = await getEffectiveScope(context, ENTITY.CANDIDATE, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  const hardMatch = await prisma.candidate.findUnique({ where: { phone: input.phone } });
  const softMatch = input.email
    ? await prisma.candidate.findFirst({
        where: { email: input.email, ...(hardMatch ? { id: { not: hardMatch.id } } : {}) },
      })
    : null;

  return { hardMatch, softMatch };
}

export async function createCandidate(context: SessionContext, input: CandidateCreateInput) {
  await requirePermission(context, ENTITY.CANDIDATE, "CREATE");

  if (input.sourceId) {
    await assertControlledListValue("CANDIDATE_SOURCE", input.sourceId, "source");
  }

  const customFields = await validateCandidateCustomFields(input.customFields);

  // Phone is the PRD's stated unique key (§9) — a hard match always blocks
  // creation in favor of merge/link (§11.2, BR1).
  const hardMatch = await prisma.candidate.findUnique({ where: { phone: input.phone } });
  if (hardMatch) {
    throw new DuplicateCandidateError("A candidate with this phone number already exists.", hardMatch.id);
  }

  // Email is only a secondary signal (BR2) — never blocks, just surfaced below.
  const softMatch = input.email ? await prisma.candidate.findFirst({ where: { email: input.email } }) : null;

  const created = await prisma.candidate.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      location: input.location,
      currentCompensation: input.currentCompensation,
      expectedCompensation: input.expectedCompensation,
      noticePeriodDays: input.noticePeriodDays,
      earliestAvailability: input.earliestAvailability,
      totalExperienceYears: input.totalExperienceYears,
      skills: input.skills,
      tags: input.tags,
      experienceHistory: (input.experienceHistory as Prisma.InputJsonValue | undefined) ?? undefined,
      educationHistory: (input.educationHistory as Prisma.InputJsonValue | undefined) ?? undefined,
      consentGivenAt: input.consentGivenAt,
      customFields: customFields as Prisma.InputJsonValue,
      sourceId: input.sourceId,
      createdById: context.userId,
    },
    include: candidateDetailInclude,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_CREATED,
    entityType: ENTITY.CANDIDATE,
    entityId: created.id,
    changes: { after: { name: created.name, phone: created.phone } },
  });

  return { ...created, possibleDuplicateOf: softMatch?.id ?? null };
}

export async function updateCandidate(
  context: SessionContext,
  id: string,
  input: CandidateUpdateInput,
) {
  const existing = await prisma.candidate.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, existing, "UPDATE");

  if (input.sourceId) {
    await assertControlledListValue("CANDIDATE_SOURCE", input.sourceId, "source");
  }

  if (input.phone && input.phone !== existing.phone) {
    const phoneOwner = await prisma.candidate.findUnique({ where: { phone: input.phone } });
    if (phoneOwner) {
      throw new DuplicateCandidateError(
        "A candidate with this phone number already exists.",
        phoneOwner.id,
      );
    }
  }

  const customFields =
    input.customFields !== undefined ? await validateCandidateCustomFields(input.customFields) : undefined;

  const data: Prisma.CandidateUpdateManyMutationInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.phone !== undefined && { phone: input.phone }),
    ...(input.email !== undefined && { email: input.email }),
    ...(input.location !== undefined && { location: input.location }),
    ...(input.currentCompensation !== undefined && { currentCompensation: input.currentCompensation }),
    ...(input.expectedCompensation !== undefined && { expectedCompensation: input.expectedCompensation }),
    ...(input.noticePeriodDays !== undefined && { noticePeriodDays: input.noticePeriodDays }),
    ...(input.earliestAvailability !== undefined && { earliestAvailability: input.earliestAvailability }),
    ...(input.totalExperienceYears !== undefined && { totalExperienceYears: input.totalExperienceYears }),
    ...(input.skills !== undefined && { skills: input.skills }),
    ...(input.tags !== undefined && { tags: input.tags }),
    ...(input.experienceHistory !== undefined && {
      experienceHistory: input.experienceHistory as Prisma.InputJsonValue,
    }),
    ...(input.educationHistory !== undefined && {
      educationHistory: input.educationHistory as Prisma.InputJsonValue,
    }),
    ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
    ...(customFields !== undefined && { customFields: customFields as Prisma.InputJsonValue }),
    version: { increment: 1 },
  };

  const result = await prisma.candidate.updateMany({ where: { id, version: input.version }, data });
  if (result.count === 0) {
    throw new ConflictError("This candidate was changed by someone else. Reload and try again.");
  }

  const updated = await prisma.candidate.findUniqueOrThrow({ where: { id }, include: candidateDetailInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_UPDATED,
    entityType: ENTITY.CANDIDATE,
    entityId: id,
    changes: { before: existing, after: data },
  });

  return updated;
}

export async function deleteCandidate(context: SessionContext, id: string) {
  const existing = await prisma.candidate.findUnique({
    where: { id },
    include: { documents: true },
  });
  if (!existing) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, existing, "DELETE");

  // Module 4: a candidate with applications can't be silently hard-deleted —
  // that would strand pipeline/interview/offer history. Application.candidateId
  // defaults to onDelete: Restrict as a database-level backstop; this check
  // exists so the caller gets a clean ValidationError instead of an unhandled
  // constraint-violation error.
  const applicationCount = await prisma.application.count({ where: { candidateId: id } });
  if (applicationCount > 0) {
    throw new ValidationError("This candidate has applications and cannot be deleted.");
  }

  const storage = getStorageProvider();
  for (const document of existing.documents) {
    await storage.delete(document.storageKey);
  }

  await prisma.candidate.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_DELETED,
    entityType: ENTITY.CANDIDATE,
    entityId: id,
    changes: { before: { name: existing.name, phone: existing.phone } },
  });
}

/**
 * Fills only the target's empty fields from the source (never overwrites
 * populated data), unions skills/tags, reassigns the source's documents and
 * notes to the target, then deletes the source — the Phase 2 merge design.
 */
export async function mergeCandidates(context: SessionContext, targetId: string, input: CandidateMergeInput) {
  if (targetId === input.sourceCandidateId) {
    throw new ValidationError("A candidate cannot be merged into itself.");
  }

  const [target, source] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: targetId } }),
    prisma.candidate.findUnique({ where: { id: input.sourceCandidateId } }),
  ]);
  if (!target) {
    throw new NotFoundError("Candidate not found.");
  }
  if (!source) {
    throw new ValidationError("Source candidate not found.");
  }

  await assertCandidateAccess(context, target, "UPDATE");
  await assertCandidateAccess(context, source, "DELETE");

  const fillIfEmpty = <T>(targetValue: T | null | undefined, sourceValue: T | null | undefined) =>
    targetValue === null || targetValue === undefined ? sourceValue ?? undefined : undefined;

  const mergedCustomFields = {
    ...((source.customFields as Record<string, unknown> | null) ?? {}),
    ...((target.customFields as Record<string, unknown> | null) ?? {}),
  };

  const data: Prisma.CandidateUncheckedUpdateManyInput = {
    email: fillIfEmpty(target.email, source.email),
    location: fillIfEmpty(target.location, source.location),
    currentCompensation: fillIfEmpty(target.currentCompensation, source.currentCompensation),
    expectedCompensation: fillIfEmpty(target.expectedCompensation, source.expectedCompensation),
    noticePeriodDays: fillIfEmpty(target.noticePeriodDays, source.noticePeriodDays),
    earliestAvailability: fillIfEmpty(target.earliestAvailability, source.earliestAvailability),
    totalExperienceYears: fillIfEmpty(target.totalExperienceYears, source.totalExperienceYears),
    experienceHistory:
      target.experienceHistory ?? (source.experienceHistory as Prisma.InputJsonValue | undefined) ?? undefined,
    educationHistory:
      target.educationHistory ?? (source.educationHistory as Prisma.InputJsonValue | undefined) ?? undefined,
    sourceId: fillIfEmpty(target.sourceId, source.sourceId),
    skills: Array.from(new Set([...target.skills, ...source.skills])),
    tags: Array.from(new Set([...target.tags, ...source.tags])),
    customFields: mergedCustomFields as Prisma.InputJsonValue,
    version: { increment: 1 },
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.candidate.updateMany({
      where: { id: targetId, version: input.version },
      data,
    });
    if (result.count === 0) {
      throw new ConflictError("This candidate was changed by someone else. Reload and try again.");
    }

    await tx.candidateDocument.updateMany({
      where: { candidateId: source.id },
      data: { candidateId: targetId },
    });
    await tx.candidateNote.updateMany({
      where: { candidateId: source.id },
      data: { candidateId: targetId },
    });
    await tx.candidate.delete({ where: { id: source.id } });

    return tx.candidate.findUniqueOrThrow({ where: { id: targetId }, include: candidateDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_MERGED,
    entityType: ENTITY.CANDIDATE,
    entityId: targetId,
    changes: { after: { mergedCandidateId: source.id } },
  });

  return updated;
}

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
];

export async function addCandidateDocument(
  context: SessionContext,
  candidateId: string,
  input: { documentTypeId: string; fileName: string; mimeType: string; buffer: Buffer },
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "UPDATE");
  await assertControlledListValue("DOCUMENT_TYPE", input.documentTypeId, "document type");

  if (input.buffer.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
    throw new ValidationError("File exceeds the 10MB size limit.");
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(`Unsupported file type "${input.mimeType}".`);
  }

  const storage = getStorageProvider();
  const { storageKey } = await storage.save({
    candidateId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    buffer: input.buffer,
  });

  const document = await prisma.candidateDocument.create({
    data: {
      candidateId,
      documentTypeId: input.documentTypeId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.buffer.byteLength,
      storageKey,
      uploadedById: context.userId,
    },
    include: { documentType: true, uploadedBy: { select: userSummarySelect } },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_DOCUMENT_ADDED,
    entityType: ENTITY.CANDIDATE,
    entityId: candidateId,
    changes: { after: { documentId: document.id, fileName: document.fileName } },
  });

  return document;
}

export async function getCandidateDocumentForDownload(
  context: SessionContext,
  candidateId: string,
  documentId: string,
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "READ");

  const document = await prisma.candidateDocument.findUnique({ where: { id: documentId } });
  if (!document || document.candidateId !== candidateId) {
    throw new NotFoundError("Document not found.");
  }

  const storage = getStorageProvider();
  const buffer = await storage.read(document.storageKey);

  return { document, buffer };
}

export async function deleteCandidateDocument(
  context: SessionContext,
  candidateId: string,
  documentId: string,
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "UPDATE");

  const document = await prisma.candidateDocument.findUnique({ where: { id: documentId } });
  if (!document || document.candidateId !== candidateId) {
    throw new NotFoundError("Document not found.");
  }

  const storage = getStorageProvider();
  await storage.delete(document.storageKey);
  await prisma.candidateDocument.delete({ where: { id: documentId } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_DOCUMENT_DELETED,
    entityType: ENTITY.CANDIDATE,
    entityId: candidateId,
    changes: { before: { documentId: document.id, fileName: document.fileName } },
  });
}

/**
 * Extensible read model (§11.2's candidate timeline). CandidateNote feeds
 * the original "note" item type; Module 4 added "application_created"/
 * "application_stage_changed"/"application_rejected"/"application_withdrawn";
 * Module 5 added "interview_scheduled"/"interview_completed"/
 * "interview_cancelled"/"interview_feedback_submitted" (derived from
 * Interview/InterviewFeedback rows, joined through Application the same
 * way ApplicationEvent is); Module 6 adds "offer_created"/"offer_approved"/
 * "offer_approval_rejected"/"offer_extended"/"offer_accepted"/
 * "offer_declined"/"offer_revoked" (derived from Offer/OfferApproval rows,
 * same join pattern). Module 7 adds "handoff_initiated"/"handoff_delivered"/
 * "handoff_accepted"/"handoff_exception" (derived from HandoffRecord/
 * HandoffDeliveryAttempt rows, same join-through-Application pattern) —
 * each addition without changing the existing contract. Future modules
 * (Communication Hub) add more `type`s the same way.
 */
export async function getCandidateTimeline(context: SessionContext, candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "READ");

  const [notes, applications, interviews, offers, handoffs] = await Promise.all([
    prisma.candidateNote.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: userSummarySelect } },
    }),
    prisma.application.findMany({
      where: { candidateId },
      include: {
        job: { select: { id: true, title: true } },
        stage: true,
        events: {
          include: {
            actor: { select: userSummarySelect },
            fromStage: true,
            toStage: true,
            reason: true,
          },
        },
      },
    }),
    // Module 5 — joined through Application, the same way ApplicationEvent
    // is, since Interview belongs to an application's pipeline, not the
    // candidate directly.
    prisma.interview.findMany({
      where: { application: { candidateId } },
      include: {
        application: { select: { jobId: true, job: { select: { title: true } } } },
        cancellationReason: true,
        feedback: { include: { interviewer: { select: userSummarySelect } } },
      },
    }),
    // Module 6 — joined through Application, the same way Interview is.
    prisma.offer.findMany({
      where: { application: { candidateId } },
      include: {
        application: { select: { jobId: true, job: { select: { title: true } } } },
        outcomeReason: true,
        approvals: { where: { status: { not: "PENDING" } }, include: { approver: { select: userSummarySelect } } },
      },
    }),
    // Module 7 — joined through Application, the same way Offer is.
    prisma.handoffRecord.findMany({
      where: { application: { candidateId } },
      include: {
        application: { select: { jobId: true, job: { select: { title: true } } } },
        initiatedBy: { select: userSummarySelect },
        acknowledgedBy: { select: userSummarySelect },
        attempts: { include: { attemptedBy: { select: userSummarySelect } } },
      },
    }),
  ]);

  const noteItems = notes.map((note) => ({
    type: "note" as const,
    id: note.id,
    body: note.body,
    author: note.author,
    createdAt: note.createdAt,
  }));

  const applicationItems = applications.map((application) => ({
    type: "application_created" as const,
    id: application.id,
    jobId: application.jobId,
    jobTitle: application.job.title,
    stage: application.stage.name,
    createdAt: application.createdAt,
  }));

  const eventItems = applications.flatMap((application) =>
    application.events.map((event) => {
      const base = {
        id: event.id,
        applicationId: application.id,
        jobId: application.jobId,
        jobTitle: application.job.title,
        actor: event.actor,
        note: event.note,
        createdAt: event.createdAt,
      };

      if (event.type === "STAGE_CHANGE") {
        return {
          ...base,
          type: "application_stage_changed" as const,
          fromStage: event.fromStage?.name ?? null,
          toStage: event.toStage?.name ?? null,
        };
      }

      return {
        ...base,
        type: event.type === "REJECTED" ? ("application_rejected" as const) : ("application_withdrawn" as const),
        reason: event.reason?.label ?? null,
      };
    }),
  );

  // Module 5 — no separate InterviewEvent history table exists (a
  // deliberate simplification: Interview has far fewer state transitions
  // than Application, and nothing else needs a queryable history of them
  // yet), so these items are derived directly from Interview/
  // InterviewFeedback rows rather than from an event log. `updatedAt` is
  // the best available proxy for "when this status change happened" —
  // matching completedAt/cancelledAt would need that extra table.
  const interviewScheduledItems = interviews.map((interview) => ({
    type: "interview_scheduled" as const,
    id: `${interview.id}:scheduled`,
    jobId: interview.application.jobId,
    jobTitle: interview.application.job.title,
    roundName: interview.roundName,
    scheduledAt: interview.scheduledAt,
    createdAt: interview.createdAt,
  }));

  const interviewStatusItems = interviews
    .filter((interview) => interview.status !== "SCHEDULED")
    .map((interview) => ({
      type: (interview.status === "COMPLETED" ? "interview_completed" : "interview_cancelled") as
        | "interview_completed"
        | "interview_cancelled",
      id: `${interview.id}:${interview.status.toLowerCase()}`,
      jobId: interview.application.jobId,
      jobTitle: interview.application.job.title,
      roundName: interview.roundName,
      reason: interview.cancellationReason?.label ?? null,
      createdAt: interview.updatedAt,
    }));

  const interviewFeedbackItems = interviews.flatMap((interview) =>
    interview.feedback.map((feedback) => ({
      type: "interview_feedback_submitted" as const,
      id: feedback.id,
      jobId: interview.application.jobId,
      jobTitle: interview.application.job.title,
      roundName: interview.roundName,
      interviewer: feedback.interviewer,
      recommendation: feedback.recommendation,
      createdAt: feedback.submittedAt,
    })),
  );

  // Module 6 — same "no separate event-history table, updatedAt is the
  // timestamp proxy" choice as Interview above, except the one transition
  // rich enough to need its own record — the approval decision — has one:
  // OfferApproval. Its rows are already filtered to non-PENDING above.
  const offerCreatedItems = offers.map((offer) => ({
    type: "offer_created" as const,
    id: `${offer.id}:created`,
    jobId: offer.application.jobId,
    jobTitle: offer.application.job.title,
    compensation: offer.compensation.toString(),
    createdAt: offer.createdAt,
  }));

  const offerApprovalItems = offers.flatMap((offer) =>
    offer.approvals.map((approval) => ({
      type: (approval.status === "APPROVED" ? "offer_approved" : "offer_approval_rejected") as
        | "offer_approved"
        | "offer_approval_rejected",
      id: approval.id,
      jobId: offer.application.jobId,
      jobTitle: offer.application.job.title,
      approver: approval.approver,
      comments: approval.comments,
      // decidedAt is set whenever status leaves PENDING (see transitionOffer),
      // so this cast is safe given the `status: { not: "PENDING" }` filter above.
      createdAt: approval.decidedAt as Date,
    })),
  );

  const offerStatusItems = offers
    .filter((offer) => offer.status === "EXTENDED" || offer.status === "ACCEPTED" || offer.status === "DECLINED" || offer.status === "REVOKED")
    .map((offer) => ({
      type: `offer_${offer.status.toLowerCase()}` as "offer_extended" | "offer_accepted" | "offer_declined" | "offer_revoked",
      id: `${offer.id}:${offer.status.toLowerCase()}`,
      jobId: offer.application.jobId,
      jobTitle: offer.application.job.title,
      reason: offer.outcomeReason?.label ?? null,
      createdAt: offer.updatedAt,
    }));

  // Module 7 — no separate HandoffStatusChange history table exists (same
  // "don't over-engineer this" choice as Handoff's lifecycle itself, see
  // schema.prisma). Delivery outcomes come from HandoffDeliveryAttempt
  // (one item per attempt); the acknowledgement decision has no attempt row
  // of its own, so it's derived straight from HandoffRecord.acknowledgedAt.
  const handoffInitiatedItems = handoffs.map((handoff) => ({
    type: "handoff_initiated" as const,
    id: `${handoff.id}:initiated`,
    jobId: handoff.application.jobId,
    jobTitle: handoff.application.job.title,
    deliveryMethod: handoff.deliveryMethod,
    initiatedBy: handoff.initiatedBy,
    createdAt: handoff.createdAt,
  }));

  const handoffDeliveryItems = handoffs.flatMap((handoff) =>
    handoff.attempts.map((attempt) => ({
      type: (attempt.succeeded ? "handoff_delivered" : "handoff_exception") as "handoff_delivered" | "handoff_exception",
      id: `${attempt.id}:attempt`,
      jobId: handoff.application.jobId,
      jobTitle: handoff.application.job.title,
      actor: attempt.attemptedBy,
      reason: attempt.errorMessage,
      createdAt: attempt.attemptedAt,
    })),
  );

  const handoffAcknowledgedItems = handoffs
    .filter((handoff) => handoff.acknowledgedBy && handoff.acknowledgedAt)
    .map((handoff) => ({
      type: (handoff.status === "ACCEPTED" ? "handoff_accepted" : "handoff_exception") as
        | "handoff_accepted"
        | "handoff_exception",
      id: `${handoff.id}:acknowledged`,
      jobId: handoff.application.jobId,
      jobTitle: handoff.application.job.title,
      actor: handoff.acknowledgedBy!,
      reason: handoff.exceptionReason,
      createdAt: handoff.acknowledgedAt as Date,
    }));

  const items = [
    ...noteItems,
    ...applicationItems,
    ...eventItems,
    ...interviewScheduledItems,
    ...interviewStatusItems,
    ...interviewFeedbackItems,
    ...offerCreatedItems,
    ...offerApprovalItems,
    ...offerStatusItems,
    ...handoffInitiatedItems,
    ...handoffDeliveryItems,
    ...handoffAcknowledgedItems,
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { items };
}

/** Notes are create-only — §9 describes this category as an immutable audit log. */
export async function addCandidateNote(
  context: SessionContext,
  candidateId: string,
  input: CandidateNoteInput,
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "UPDATE");

  const note = await prisma.candidateNote.create({
    data: { candidateId, body: input.body, authorId: context.userId },
    include: { author: { select: userSummarySelect } },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_NOTE_ADDED,
    entityType: ENTITY.CANDIDATE,
    entityId: candidateId,
    changes: { after: { noteId: note.id } },
  });

  return note;
}

export { buildScopedWhere as buildCandidateScopedWhere, candidateDetailInclude, candidateListInclude };
