import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { can, getFieldAccess, requirePermission, ForbiddenError } from "@/lib/authz/authorize";
import type { FieldAccessMap } from "@/lib/authz/authorize";
import { assertWritableFields, sanitizeForRead } from "@/lib/authz/field-sanitizer";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { buildCustomFieldValueSchema } from "@/lib/custom-fields/dynamic-schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  CustomObjectRecordCreateInput,
  CustomObjectRecordQuery,
  CustomObjectRecordUpdateInput,
  CustomObjectRelationCreateInput,
} from "@/lib/validations/custom-object";

/**
 * §10.1: a CustomObjectRelation may only point at a core entity — see the
 * model's own schema.prisma comment ("Links a custom object record to a
 * core entity"), not at another custom object record. Deliberately a
 * separate, narrower table than assertKnownEntityType in custom-fields.ts,
 * which also accepts a CustomObjectDefinition's own apiKey — inappropriate
 * here since relations don't link records to other records.
 *
 * Resolves each target's own ownership field so linking can be gated by
 * that entity's *own* RBAC scope (e.g. Candidate:READ at TEAM/OWN), not
 * just CUSTOM_OBJECT_DEFINITION — otherwise a caller with only
 * CUSTOM_OBJECT_DEFINITION:UPDATE could link, and later see the id of, a
 * Candidate/Job/etc. entirely outside their own scope for that resource.
 * Field names mirror each service's own assert*Access ownership check
 * exactly (assertJobAccess/assertCandidateAccess/assertApplicationAccess/
 * assertManageAccess/assertOfferAccess/assertHandoffAccess).
 */
const ENTITY_OWNERSHIP_LOOKUPS: Record<string, (id: string) => Promise<{ ownerId: string | null } | null>> = {
  [ENTITY.JOB]: (id) =>
    prisma.job.findUnique({ where: { id }, select: { primaryRecruiterId: true } }).then((row) =>
      row ? { ownerId: row.primaryRecruiterId } : null,
    ),
  [ENTITY.CANDIDATE]: (id) =>
    prisma.candidate.findUnique({ where: { id }, select: { createdById: true } }).then((row) =>
      row ? { ownerId: row.createdById } : null,
    ),
  [ENTITY.APPLICATION]: (id) =>
    prisma.application.findUnique({ where: { id }, select: { ownerId: true } }).then((row) =>
      row ? { ownerId: row.ownerId } : null,
    ),
  [ENTITY.INTERVIEW]: (id) =>
    prisma.interview.findUnique({ where: { id }, select: { scheduledById: true } }).then((row) =>
      row ? { ownerId: row.scheduledById } : null,
    ),
  [ENTITY.OFFER]: (id) =>
    prisma.offer.findUnique({ where: { id }, select: { createdById: true } }).then((row) =>
      row ? { ownerId: row.createdById } : null,
    ),
  [ENTITY.HANDOFF]: (id) =>
    prisma.handoffRecord.findUnique({ where: { id }, select: { initiatedById: true } }).then((row) =>
      row ? { ownerId: row.initiatedById } : null,
    ),
};

async function assertCanLinkRelatedEntity(
  context: SessionContext,
  relatedEntityType: string,
  relatedEntityId: string,
) {
  const lookup = ENTITY_OWNERSHIP_LOOKUPS[relatedEntityType];
  if (!lookup) {
    throw new ValidationError(`"${relatedEntityType}" is not a linkable entity type.`);
  }
  const entity = await lookup(relatedEntityId);
  if (!entity) {
    throw new NotFoundError(`${relatedEntityType} not found.`);
  }
  if (!(await can(context, relatedEntityType, "READ", { ownerId: entity.ownerId }))) {
    throw new ForbiddenError();
  }
}

async function getDefinitionOrThrow(definitionId: string) {
  const definition = await prisma.customObjectDefinition.findUnique({ where: { id: definitionId } });
  if (!definition) {
    throw new NotFoundError("Custom object definition not found.");
  }
  return definition;
}

/** Mirrors validateCustomFields in jobs.ts exactly, keyed on the custom object's own apiKey rather than a fixed ENTITY member. */
async function validateRecordData(apiKey: string, data: Record<string, unknown> | undefined) {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: apiKey, isActive: true },
  });
  if (definitions.length === 0) {
    return {};
  }
  return buildCustomFieldValueSchema(definitions).parse(data ?? {});
}

/**
 * sanitizeForRead/assertWritableFields (src/lib/authz/field-sanitizer.ts)
 * special-case a literal `customFields` key, not `data` — these two
 * adapters alias one to the other around the call so the shared,
 * already-tested module never needs to learn a second field name.
 */
function sanitizeRecordForRead<T extends Record<string, unknown> & { data: unknown }>(
  record: T,
  fieldAccess: FieldAccessMap,
): T {
  const aliased = sanitizeForRead(
    { ...record, customFields: record.data as Record<string, unknown> },
    fieldAccess,
  );
  const { customFields, ...rest } = aliased;
  return { ...rest, data: customFields } as unknown as T;
}

function assertDataWritable(data: Record<string, unknown>, fieldAccess: FieldAccessMap) {
  assertWritableFields({ customFields: data }, fieldAccess);
}

export async function listCustomObjectRecords(context: SessionContext, query: CustomObjectRecordQuery) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "READ");

  const where = {
    ...(query.definitionId ? { definitionId: query.definitionId } : {}),
    ...(query.relatedEntityType && query.relatedEntityId
      ? {
          relations: {
            some: {
              relatedEntityType: query.relatedEntityType,
              relatedEntityId: query.relatedEntityId,
            },
          },
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.customObjectRecord.findMany({
      where,
      include: { definition: true, relations: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.customObjectRecord.count({ where }),
  ]);

  // Records in one page can belong to different CustomObjectDefinitions —
  // FieldPermission.resource is keyed on each definition's own apiKey (see
  // sanitizeRecordForRead below), so field access is resolved once per
  // distinct apiKey present rather than assuming a single resource for the
  // whole list.
  const apiKeys = [...new Set(records.map((record) => record.definition.apiKey))];
  const fieldAccessByApiKey = new Map(
    await Promise.all(
      apiKeys.map(async (apiKey) => [apiKey, await getFieldAccess(context, apiKey)] as const),
    ),
  );

  return {
    records: records.map((record) =>
      sanitizeRecordForRead(record, fieldAccessByApiKey.get(record.definition.apiKey) ?? {}),
    ),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getCustomObjectRecord(context: SessionContext, id: string) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "READ");

  const record = await prisma.customObjectRecord.findUnique({
    where: { id },
    include: { definition: true, relations: true },
  });
  if (!record) {
    throw new NotFoundError("Custom object record not found.");
  }

  const fieldAccess = await getFieldAccess(context, record.definition.apiKey);
  return sanitizeRecordForRead(record, fieldAccess);
}

export async function createCustomObjectRecord(
  context: SessionContext,
  input: CustomObjectRecordCreateInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "CREATE");

  const definition = await getDefinitionOrThrow(input.definitionId);
  const data = await validateRecordData(definition.apiKey, input.data);

  const fieldAccess = await getFieldAccess(context, definition.apiKey);
  assertDataWritable(data, fieldAccess);

  const created = await prisma.customObjectRecord.create({
    data: {
      definitionId: definition.id,
      data: data as Prisma.InputJsonValue,
      createdById: context.userId,
    },
    include: { definition: true, relations: true },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_RECORD_CREATED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: created.id,
    changes: { after: created },
  });

  return sanitizeRecordForRead(created, fieldAccess);
}

export async function updateCustomObjectRecord(
  context: SessionContext,
  id: string,
  input: CustomObjectRecordUpdateInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "UPDATE");

  const before = await prisma.customObjectRecord.findUnique({
    where: { id },
    include: { definition: true },
  });
  if (!before) {
    throw new NotFoundError("Custom object record not found.");
  }

  const data = await validateRecordData(before.definition.apiKey, input.data);

  const fieldAccess = await getFieldAccess(context, before.definition.apiKey);
  assertDataWritable(data, fieldAccess);

  const updated = await prisma.customObjectRecord.update({
    where: { id },
    data: { data: data as Prisma.InputJsonValue },
    include: { definition: true, relations: true },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_RECORD_UPDATED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: updated.id,
    changes: { before, after: updated },
  });

  return sanitizeRecordForRead(updated, fieldAccess);
}

export async function deleteCustomObjectRecord(context: SessionContext, id: string) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "DELETE");

  const existing = await prisma.customObjectRecord.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Custom object record not found.");
  }

  // Cascade-deletes the record's own CustomObjectRelation rows (see
  // onDelete: Cascade on CustomObjectRelation.record in schema.prisma).
  await prisma.customObjectRecord.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_RECORD_DELETED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: id,
    changes: { before: existing },
  });
}

export async function listCustomObjectRelations(context: SessionContext, recordId: string) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "READ");

  const record = await prisma.customObjectRecord.findUnique({ where: { id: recordId } });
  if (!record) {
    throw new NotFoundError("Custom object record not found.");
  }

  return prisma.customObjectRelation.findMany({
    where: { recordId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createCustomObjectRelation(
  context: SessionContext,
  input: CustomObjectRelationCreateInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "UPDATE");

  const record = await prisma.customObjectRecord.findUnique({ where: { id: input.recordId } });
  if (!record) {
    throw new NotFoundError("Custom object record not found.");
  }

  await assertCanLinkRelatedEntity(context, input.relatedEntityType, input.relatedEntityId);

  // No unique constraint on the (recordId, relatedEntityType,
  // relatedEntityId) triple in the schema (see CustomObjectRelation's own
  // comment) — an application-level duplicate check is the only guard.
  const existingRelation = await prisma.customObjectRelation.findFirst({
    where: {
      recordId: input.recordId,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
    },
  });
  if (existingRelation) {
    return existingRelation;
  }

  const created = await prisma.customObjectRelation.create({ data: input });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_RELATION_CREATED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

export async function deleteCustomObjectRelation(context: SessionContext, id: string) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "UPDATE");

  const existing = await prisma.customObjectRelation.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Custom object relation not found.");
  }

  await prisma.customObjectRelation.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_RELATION_DELETED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: id,
    changes: { before: existing },
  });
}
