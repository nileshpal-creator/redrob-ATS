import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { OrganizationSettingsUpdateInput } from "@/lib/validations/organization";

/**
 * `Organization` is a DB singleton (see the model's own comment in
 * schema.prisma) — there is exactly one row, seeded once by prisma/seed.ts,
 * never a per-user or per-org record. No role is seeded with an
 * ORGANIZATION grant (this resource has sat registered but unused since
 * Module 1), so in practice only a super-admin role passes these checks
 * today — the same "in practice super-admin only" shape
 * SAVED_REPORT/WORKFLOW_DEFINITION's own run-due endpoints already
 * document, not a bespoke isSuperAdmin check here.
 */
export async function getOrganizationSettings(context: SessionContext) {
  await requirePermission(context, ENTITY.ORGANIZATION, "READ");
  const organization = await prisma.organization.findFirst();
  if (!organization) {
    throw new NotFoundError("Organization settings not found.");
  }
  return organization;
}

export async function updateOrganizationSettings(context: SessionContext, input: OrganizationSettingsUpdateInput) {
  await requirePermission(context, ENTITY.ORGANIZATION, "UPDATE");
  const organization = await prisma.organization.findFirst();
  if (!organization) {
    throw new NotFoundError("Organization settings not found.");
  }

  const updated = await prisma.organization.update({
    where: { id: organization.id },
    data: {
      ...(input.interviewReminderLeadMinutes !== undefined && {
        interviewReminderLeadMinutes: input.interviewReminderLeadMinutes,
      }),
      ...(input.offerTatThresholdDays !== undefined && { offerTatThresholdDays: input.offerTatThresholdDays }),
      ...(input.candidateRetentionDays !== undefined && { candidateRetentionDays: input.candidateRetentionDays }),
    },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.ORGANIZATION_SETTINGS_UPDATED,
    entityType: ENTITY.ORGANIZATION,
    entityId: updated.id,
    changes: {
      before: {
        interviewReminderLeadMinutes: organization.interviewReminderLeadMinutes,
        offerTatThresholdDays: organization.offerTatThresholdDays,
        candidateRetentionDays: organization.candidateRetentionDays,
      },
      after: {
        interviewReminderLeadMinutes: updated.interviewReminderLeadMinutes,
        offerTatThresholdDays: updated.offerTatThresholdDays,
        candidateRetentionDays: updated.candidateRetentionDays,
      },
    },
  });

  return updated;
}
