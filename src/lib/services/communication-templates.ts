import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  CommunicationTemplateCreateInput,
  CommunicationTemplateQuery,
  CommunicationTemplateUpdateInput,
} from "@/lib/validations/communication-template";

// Deliberately not permission-gated: a template's *content* is what any
// sender picks from — the bulk-email dialog needs to read active templates
// regardless of whether that user can administer them, the same reasoning
// listCustomFieldDefinitions applies to field definitions. Mutations
// (create/update below) remain gated.
export async function listCommunicationTemplates(
  _context: SessionContext,
  query: CommunicationTemplateQuery,
) {
  return prisma.communicationTemplate.findMany({
    where: { channel: query.channel, isActive: query.isActive },
    orderBy: { name: "asc" },
  });
}

/**
 * Shared by any sender flow that needs to resolve a template before
 * rendering it (today: bulkEmailApplications in applications.ts) — a
 * template must exist and be active; an inactive template can't be picked
 * up going forward but past sends that used it keep their own rendered
 * snapshot (ApplicationEmailLog.subject/body), so deactivating one never
 * changes history.
 */
export async function getActiveCommunicationTemplateOrThrow(templateId: string) {
  const template = await prisma.communicationTemplate.findUnique({ where: { id: templateId } });
  if (!template || !template.isActive) {
    throw new ValidationError("Selected template is not available.");
  }
  return template;
}

export async function createCommunicationTemplate(
  context: SessionContext,
  input: CommunicationTemplateCreateInput,
) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "CREATE");

  const existing = await prisma.communicationTemplate.findUnique({ where: { name: input.name } });
  if (existing) {
    throw new ValidationError(`A template named "${input.name}" already exists.`);
  }

  // The findUnique above is a courtesy for a clean error message — it can't
  // prevent two concurrent creates from both passing it, so the unique index
  // on `name` is the real guard. Without this catch, a race loses to an
  // unhandled 500 instead of the same ValidationError the check above was
  // written to produce — same pattern as createOffer's own comment.
  const created = await prisma.communicationTemplate
    .create({ data: { ...input, createdById: context.userId } })
    .catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ValidationError(`A template named "${input.name}" already exists.`);
      }
      throw error;
    });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_CREATED,
    entityType: ENTITY.COMMUNICATION_TEMPLATE,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

export async function updateCommunicationTemplate(
  context: SessionContext,
  id: string,
  input: CommunicationTemplateUpdateInput,
) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "UPDATE");

  const before = await prisma.communicationTemplate.findUnique({ where: { id } });
  if (!before) {
    throw new NotFoundError("Template not found.");
  }

  const updated = await prisma.communicationTemplate.update({ where: { id }, data: input });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_UPDATED,
    entityType: ENTITY.COMMUNICATION_TEMPLATE,
    entityId: updated.id,
    changes: { before, after: updated },
  });

  return updated;
}
