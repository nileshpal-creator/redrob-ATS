import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type {
  CommunicationTemplateVersionCreateInput,
  CommunicationTemplateVersionDecideInput,
} from "@/lib/validations/communication-template-version";

const userSummarySelect = { id: true, name: true, email: true } as const;

const versionInclude = {
  createdBy: { select: userSummarySelect },
  submittedBy: { select: userSummarySelect },
  decidedBy: { select: userSummarySelect },
} as const;

async function assertTemplateExists(templateId: string) {
  const template = await prisma.communicationTemplate.findUnique({ where: { id: templateId } });
  if (!template) {
    throw new NotFoundError("Template not found.");
  }
  return template;
}

async function getVersionOrThrow(templateId: string, versionId: string) {
  const version = await prisma.communicationTemplateVersion.findUnique({ where: { id: versionId } });
  if (!version || version.templateId !== templateId) {
    throw new NotFoundError("Version not found.");
  }
  return version;
}

/**
 * Gated by READ, not UPDATE — an approver only ever holds READ+APPROVE (see
 * the seeded Hiring Manager grant), and still needs to see version history
 * to act on a pending one. The page itself already requires READ to load
 * (guardPage on /admin/communication-templates), so this doesn't widen
 * access beyond "can see the page at all."
 */
export async function listCommunicationTemplateVersions(context: SessionContext, templateId: string) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "READ");
  await assertTemplateExists(templateId);

  return prisma.communicationTemplateVersion.findMany({
    where: { templateId },
    include: versionInclude,
    orderBy: [{ language: "asc" }, { versionNumber: "desc" }],
  });
}

export async function createCommunicationTemplateVersion(
  context: SessionContext,
  templateId: string,
  input: CommunicationTemplateVersionCreateInput,
) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "UPDATE");
  await assertTemplateExists(templateId);

  const last = await prisma.communicationTemplateVersion.findFirst({
    where: { templateId, language: input.language },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  const created = await prisma.communicationTemplateVersion.create({
    data: {
      templateId,
      versionNumber,
      language: input.language,
      subject: input.subject,
      body: input.body,
      status: "DRAFT",
      createdById: context.userId,
    },
    include: versionInclude,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_VERSION_CREATED,
    entityType: ENTITY.COMMUNICATION_TEMPLATE,
    entityId: templateId,
    changes: { after: { versionId: created.id, language: created.language, versionNumber: created.versionNumber } },
  });

  return created;
}

export async function submitCommunicationTemplateVersion(context: SessionContext, templateId: string, versionId: string) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "UPDATE");
  const version = await getVersionOrThrow(templateId, versionId);

  if (version.status !== "DRAFT") {
    throw new ValidationError("Only a draft version can be submitted for approval.");
  }

  const updated = await prisma.communicationTemplateVersion.update({
    where: { id: versionId },
    data: { status: "PENDING_APPROVAL", submittedById: context.userId, submittedAt: new Date() },
    include: versionInclude,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_VERSION_SUBMITTED,
    entityType: ENTITY.COMMUNICATION_TEMPLATE,
    entityId: templateId,
    changes: { after: { versionId: updated.id } },
  });

  return updated;
}

/**
 * Approving syncs CommunicationTemplate.subject/body when `language ===
 * "en"` — that column pair is what every existing send path
 * (bulkEmailApplications, interview reminders/notifications, the workflow
 * SEND_EMAIL action) reads directly, so this is the one place a version
 * ever reaches back into the legacy row. Every other language lives only
 * in this table, resolved by resolvePersonalizedTemplateContent.
 */
export async function decideCommunicationTemplateVersion(
  context: SessionContext,
  templateId: string,
  versionId: string,
  input: CommunicationTemplateVersionDecideInput,
) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "APPROVE");
  const version = await getVersionOrThrow(templateId, versionId);

  if (version.status !== "PENDING_APPROVAL") {
    throw new ValidationError("Only a version pending approval can be decided.");
  }

  if (input.decision === "REJECT") {
    const updated = await prisma.communicationTemplateVersion.update({
      where: { id: versionId },
      data: { status: "REJECTED", decidedById: context.userId, decidedAt: new Date(), comments: input.comments },
      include: versionInclude,
    });

    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_VERSION_REJECTED,
      entityType: ENTITY.COMMUNICATION_TEMPLATE,
      entityId: templateId,
      changes: { after: { versionId: updated.id, comments: input.comments } },
    });

    return updated;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.communicationTemplateVersion.updateMany({
      where: { templateId, language: version.language, status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });

    const activated = await tx.communicationTemplateVersion.update({
      where: { id: versionId },
      data: { status: "ACTIVE", decidedById: context.userId, decidedAt: new Date(), comments: input.comments },
      include: versionInclude,
    });

    if (activated.language === "en") {
      await tx.communicationTemplate.update({
        where: { id: templateId },
        data: { subject: activated.subject, body: activated.body },
      });
    }

    return activated;
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_VERSION_APPROVED,
    entityType: ENTITY.COMMUNICATION_TEMPLATE,
    entityId: templateId,
    changes: { after: { versionId: updated.id, language: updated.language, versionNumber: updated.versionNumber } },
  });

  return updated;
}

/**
 * Fast path for an approver to directly restore a previously-live version
 * without re-running submit/approve — same relationship to the normal flow
 * as rollbackWorkflowDefinition has to WorkflowDefinition's own versions.
 * Only a version that was once ACTIVE (i.e. now ARCHIVED, or already
 * ACTIVE — a no-op) can be restored; a DRAFT/PENDING_APPROVAL/REJECTED
 * version never went live and rollback isn't the right action for it.
 */
export async function rollbackCommunicationTemplateVersion(context: SessionContext, templateId: string, targetVersionId: string) {
  await requirePermission(context, ENTITY.COMMUNICATION_TEMPLATE, "APPROVE");
  const target = await getVersionOrThrow(templateId, targetVersionId);

  if (target.status !== "ARCHIVED" && target.status !== "ACTIVE") {
    throw new ValidationError("Only a previously active version can be restored.");
  }

  const restored = await prisma.$transaction(async (tx) => {
    await tx.communicationTemplateVersion.updateMany({
      where: { templateId, language: target.language, status: "ACTIVE", id: { not: target.id } },
      data: { status: "ARCHIVED" },
    });

    const activated = await tx.communicationTemplateVersion.update({
      where: { id: target.id },
      data: { status: "ACTIVE" },
      include: versionInclude,
    });

    if (activated.language === "en") {
      await tx.communicationTemplate.update({
        where: { id: templateId },
        data: { subject: activated.subject, body: activated.body },
      });
    }

    return activated;
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.COMMUNICATION_TEMPLATE_VERSION_ROLLED_BACK,
    entityType: ENTITY.COMMUNICATION_TEMPLATE,
    entityId: templateId,
    changes: { after: { versionId: restored.id, language: restored.language, versionNumber: restored.versionNumber } },
  });

  return restored;
}

/**
 * Additive personalization hook: falls back to the template's own
 * (default/"en") subject+body whenever `language` is unset or has no
 * matching ACTIVE variant — the exact behavior every caller had before this
 * function existed. Only bulkEmailApplications opts in today.
 */
export async function resolvePersonalizedTemplateContent(
  template: { id: string; subject: string; body: string },
  language: string | null | undefined,
): Promise<{ subject: string; body: string }> {
  if (!language || language === "en") {
    return { subject: template.subject, body: template.body };
  }

  const variant = await prisma.communicationTemplateVersion.findFirst({
    where: { templateId: template.id, language, status: "ACTIVE" },
  });
  if (!variant) {
    return { subject: template.subject, body: template.body };
  }
  return { subject: variant.subject, body: variant.body };
}
