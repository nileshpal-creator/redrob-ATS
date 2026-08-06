import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  CustomObjectDefinitionInput,
  CustomObjectDefinitionUpdateInput,
} from "@/lib/validations/custom-object";

export async function listCustomObjectDefinitions(context: SessionContext) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "READ");

  return prisma.customObjectDefinition.findMany({ orderBy: { createdAt: "asc" } });
}

export async function createCustomObjectDefinition(
  context: SessionContext,
  input: CustomObjectDefinitionInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "CREATE");

  const existing = await prisma.customObjectDefinition.findUnique({
    where: { apiKey: input.apiKey },
  });
  if (existing) {
    throw new ValidationError(`API key "${input.apiKey}" is already in use.`);
  }

  const created = await prisma.customObjectDefinition.create({ data: input });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_CREATED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

export async function updateCustomObjectDefinition(
  context: SessionContext,
  id: string,
  input: CustomObjectDefinitionUpdateInput,
) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "UPDATE");

  const before = await prisma.customObjectDefinition.findUnique({ where: { id } });
  if (!before) {
    throw new NotFoundError("Custom object not found.");
  }

  const updated = await prisma.customObjectDefinition.update({ where: { id }, data: input });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_UPDATED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: updated.id,
    changes: { before, after: updated },
  });

  return updated;
}

export async function deleteCustomObjectDefinition(context: SessionContext, id: string) {
  await requirePermission(context, ENTITY.CUSTOM_OBJECT_DEFINITION, "DELETE");

  const existing = await prisma.customObjectDefinition.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Custom object not found.");
  }

  await prisma.customObjectDefinition.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CUSTOM_OBJECT_DELETED,
    entityType: ENTITY.CUSTOM_OBJECT_DEFINITION,
    entityId: id,
    changes: { before: existing },
  });
}
