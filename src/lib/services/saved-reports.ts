import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { REPORT_QUERY_SCHEMAS } from "@/lib/validations/report";
import type { SavedReportCreateInput, SavedReportQuery, SavedReportUpdateInput } from "@/lib/validations/report";

const userSummarySelect = { id: true, name: true, email: true } as const;

const savedReportInclude = {
  createdBy: { select: userSummarySelect },
} satisfies Prisma.SavedReportInclude;

type SavedReportOwnership = { createdById: string };

/** Same shape as assertJobAccess/assertOfferAccess — ownership resolves against SavedReport.createdById. */
async function assertSavedReportAccess(
  context: SessionContext,
  report: SavedReportOwnership,
  action: PermissionAction,
) {
  if (await can(context, ENTITY.SAVED_REPORT, action)) return;
  if (await can(context, ENTITY.SAVED_REPORT, action, { ownerId: report.createdById })) return;
  throw new ForbiddenError();
}

/** Validates `filters` against the query schema for the given reportType — same "shape validated at the service boundary" convention as Job.customFields. */
function validateFilters(reportType: SavedReportCreateInput["reportType"], filters: Record<string, unknown>) {
  return REPORT_QUERY_SCHEMAS[reportType].parse(filters);
}

export async function listSavedReports(context: SessionContext, query: SavedReportQuery) {
  const scope = await getEffectiveScope(context, ENTITY.SAVED_REPORT, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.SavedReportWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { createdById: context.userId };
  } else if (scope === "TEAM") {
    ownerFilter = { createdById: { in: await getTeamMemberIds(context.userId) } };
  }

  return prisma.savedReport.findMany({
    where: { ...ownerFilter, reportType: query.reportType },
    include: savedReportInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getSavedReport(context: SessionContext, id: string) {
  const report = await prisma.savedReport.findUnique({ where: { id }, include: savedReportInclude });
  if (!report) {
    throw new NotFoundError("Saved report not found.");
  }
  await assertSavedReportAccess(context, report, "READ");
  return report;
}

export async function createSavedReport(context: SessionContext, input: SavedReportCreateInput) {
  await requirePermission(context, ENTITY.SAVED_REPORT, "CREATE");

  const filters = validateFilters(input.reportType, input.filters);

  const created = await prisma.savedReport.create({
    data: { ...input, filters: filters as Prisma.InputJsonValue, createdById: context.userId },
    include: savedReportInclude,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.SAVED_REPORT_CREATED,
    entityType: ENTITY.SAVED_REPORT,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

export async function updateSavedReport(context: SessionContext, id: string, input: SavedReportUpdateInput) {
  const existing = await prisma.savedReport.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Saved report not found.");
  }
  await assertSavedReportAccess(context, existing, "UPDATE");

  const nextScheduleFrequency = input.scheduleFrequency ?? existing.scheduleFrequency;
  const nextRecipientEmails = input.recipientEmails ?? existing.recipientEmails;
  if (nextScheduleFrequency !== "NONE" && nextRecipientEmails.length === 0) {
    throw new ValidationError("At least one recipient email is required when scheduling delivery.");
  }

  const filters = input.filters !== undefined ? validateFilters(existing.reportType, input.filters) : undefined;

  const data: Prisma.SavedReportUpdateManyMutationInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(filters !== undefined && { filters: filters as Prisma.InputJsonValue }),
    ...(input.scheduleFrequency !== undefined && { scheduleFrequency: input.scheduleFrequency }),
    ...(input.recipientEmails !== undefined && { recipientEmails: input.recipientEmails }),
    ...(input.exportFormat !== undefined && { exportFormat: input.exportFormat }),
    version: { increment: 1 },
  };

  const result = await prisma.savedReport.updateMany({ where: { id, version: input.version }, data });
  if (result.count === 0) {
    throw new ConflictError("This saved report was changed by someone else. Reload and try again.");
  }

  const updated = await prisma.savedReport.findUniqueOrThrow({ where: { id }, include: savedReportInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.SAVED_REPORT_UPDATED,
    entityType: ENTITY.SAVED_REPORT,
    entityId: id,
    changes: { before: existing, after: updated },
  });

  return updated;
}

export async function deleteSavedReport(context: SessionContext, id: string) {
  const existing = await prisma.savedReport.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Saved report not found.");
  }
  await assertSavedReportAccess(context, existing, "DELETE");

  // No historical FK references this row (unlike CommunicationTemplate,
  // whose deactivate-only convention exists because ApplicationEmailLog
  // keeps a Restrict-backed reference to it) — genuine hard delete, same
  // precedent as CustomFieldDefinition.
  await prisma.savedReport.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.SAVED_REPORT_DELETED,
    entityType: ENTITY.SAVED_REPORT,
    entityId: id,
    changes: { before: existing },
  });
}
