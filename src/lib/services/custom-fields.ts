import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY, CUSTOM_FIELD_CAPABLE_ENTITIES } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type {
  CustomFieldDefinitionInput,
  CustomFieldDefinitionUpdateInput,
} from "@/lib/validations/custom-field";
import { NotFoundError, ValidationError } from "@/lib/errors";

/** entityType must be a known core entity or an existing Custom Object's apiKey. */
async function assertKnownEntityType(entityType: string) {
  if (CUSTOM_FIELD_CAPABLE_ENTITIES.includes(entityType)) {
    return;
  }

  const customObject = await prisma.customObjectDefinition.findUnique({
    where: { apiKey: entityType },
    select: { id: true },
  });

  if (!customObject) {
    throw new ValidationError(
      `"${entityType}" is not a recognized entity or custom object.`,
    );
  }
}

export async function listCustomFieldDefinitions(
  context: SessionContext,
  entityType?: string,
) {
  await requirePermission(context, ENTITY.CUSTOM_FIELD_DEFINITION, "READ");

  return prisma.customFieldDefinition.findMany({
    where: entityType ? { entityType } : undefined,
    orderBy: [{ entityType: "asc" }, { sortOrder: "asc" }],
  });
}

export async function createCustomFieldDefinition(
  context: SessionContext,
  input: CustomFieldDefinitionInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_FIELD_DEFINITION, "CREATE");
  await assertKnownEntityType(input.entityType);

  const existing = await prisma.customFieldDefinition.findUnique({
    where: { entityType_key: { entityType: input.entityType, key: input.key } },
  });
  if (existing) {
    throw new ValidationError(
      `Field key "${input.key}" already exists on ${input.entityType}.`,
    );
  }

  const created = await prisma.customFieldDefinition.create({
    data: { ...input, defaultValue: input.defaultValue as Prisma.InputJsonValue | undefined },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_FIELD_CREATED,
    entityType: ENTITY.CUSTOM_FIELD_DEFINITION,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

export async function updateCustomFieldDefinition(
  context: SessionContext,
  id: string,
  input: CustomFieldDefinitionUpdateInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_FIELD_DEFINITION, "UPDATE");

  const before = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!before) {
    throw new NotFoundError("Custom field not found.");
  }

  const updated = await prisma.customFieldDefinition.update({
    where: { id },
    data: { ...input, defaultValue: input.defaultValue as Prisma.InputJsonValue | undefined },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_FIELD_UPDATED,
    entityType: ENTITY.CUSTOM_FIELD_DEFINITION,
    entityId: updated.id,
    changes: { before, after: updated },
  });

  return updated;
}

export async function deleteCustomFieldDefinition(context: SessionContext, id: string) {
  await requirePermission(context, ENTITY.CUSTOM_FIELD_DEFINITION, "DELETE");

  const existing = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Custom field not found.");
  }

  await prisma.customFieldDefinition.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_FIELD_DELETED,
    entityType: ENTITY.CUSTOM_FIELD_DEFINITION,
    entityId: id,
    changes: { before: existing },
  });
}
