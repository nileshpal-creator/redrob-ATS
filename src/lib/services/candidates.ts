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
 * Extensible read model (§11.2's candidate timeline) — only CandidateNote
 * feeds it today; future modules (Application, Interview, Offer,
 * Communication Hub) add more `type`s here without changing this contract.
 */
export async function getCandidateTimeline(context: SessionContext, candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) {
    throw new NotFoundError("Candidate not found.");
  }
  await assertCandidateAccess(context, candidate, "READ");

  const notes = await prisma.candidateNote.findMany({
    where: { candidateId },
    orderBy: { createdAt: "desc" },
    include: { author: { select: userSummarySelect } },
  });

  return {
    items: notes.map((note) => ({
      type: "note" as const,
      id: note.id,
      body: note.body,
      author: note.author,
      createdAt: note.createdAt,
    })),
  };
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
