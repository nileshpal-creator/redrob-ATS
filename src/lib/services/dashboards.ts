import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/generated/prisma/enums";
import { CUSTOM_FIELD_CAPABLE_ENTITIES, ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { computeWidgetData } from "@/lib/reporting/dashboard-query";
import type {
  DashboardCreateInput,
  DashboardUpdateInput,
  DashboardWidgetCreateInput,
  DashboardWidgetUpdateInput,
} from "@/lib/validations/dashboard";

const userSummarySelect = { id: true, name: true, email: true } as const;

const dashboardInclude = {
  createdBy: { select: userSummarySelect },
  widgets: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.DashboardInclude;

type DashboardOwnership = { createdById: string };

/** Same shape as assertSavedReportAccess — ownership resolves against Dashboard.createdById. */
async function assertDashboardAccess(context: SessionContext, dashboard: DashboardOwnership, action: PermissionAction) {
  if (await can(context, ENTITY.DASHBOARD, action)) return;
  if (await can(context, ENTITY.DASHBOARD, action, { ownerId: dashboard.createdById })) return;
  throw new ForbiddenError();
}

async function assertKnownWidgetEntityType(entityType: string) {
  if (CUSTOM_FIELD_CAPABLE_ENTITIES.includes(entityType)) return;
  const definition = await prisma.customObjectDefinition.findUnique({ where: { apiKey: entityType } });
  if (!definition || !definition.isActive) {
    throw new ValidationError(`"${entityType}" is not a known entity or active custom object.`);
  }
}

export async function listDashboards(context: SessionContext) {
  const scope = await getEffectiveScope(context, ENTITY.DASHBOARD, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.DashboardWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { createdById: context.userId };
  } else if (scope === "TEAM") {
    ownerFilter = { createdById: { in: await getTeamMemberIds(context.userId) } };
  }

  return prisma.dashboard.findMany({
    where: ownerFilter,
    include: { createdBy: { select: userSummarySelect } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDashboard(context: SessionContext, id: string) {
  const dashboard = await prisma.dashboard.findUnique({ where: { id }, include: dashboardInclude });
  if (!dashboard) {
    throw new NotFoundError("Dashboard not found.");
  }
  await assertDashboardAccess(context, dashboard, "READ");
  return dashboard;
}

/** Recomputes every widget against the caller's own current RBAC scope and field permissions — never cached. */
export async function getDashboardData(context: SessionContext, id: string) {
  const dashboard = await getDashboard(context, id);
  const widgets = await Promise.all(dashboard.widgets.map((widget) => computeWidgetData(context, widget)));
  return { dashboard, widgets };
}

export async function createDashboard(context: SessionContext, input: DashboardCreateInput) {
  await requirePermission(context, ENTITY.DASHBOARD, "CREATE");

  const created = await prisma.dashboard.create({
    data: { ...input, createdById: context.userId },
    include: dashboardInclude,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.DASHBOARD_CREATED,
    entityType: ENTITY.DASHBOARD,
    entityId: created.id,
    changes: { after: { name: created.name, description: created.description } },
  });

  return created;
}

export async function updateDashboard(context: SessionContext, id: string, input: DashboardUpdateInput) {
  const existing = await prisma.dashboard.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Dashboard not found.");
  }
  await assertDashboardAccess(context, existing, "UPDATE");

  const data: Prisma.DashboardUpdateManyMutationInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    version: { increment: 1 },
  };

  const result = await prisma.dashboard.updateMany({ where: { id, version: input.version }, data });
  if (result.count === 0) {
    throw new ConflictError("This dashboard was changed by someone else. Reload and try again.");
  }

  const updated = await prisma.dashboard.findUniqueOrThrow({ where: { id }, include: dashboardInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.DASHBOARD_UPDATED,
    entityType: ENTITY.DASHBOARD,
    entityId: id,
    changes: { before: { name: existing.name }, after: { name: updated.name } },
  });

  return updated;
}

export async function deleteDashboard(context: SessionContext, id: string) {
  const existing = await prisma.dashboard.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Dashboard not found.");
  }
  await assertDashboardAccess(context, existing, "DELETE");

  // Cascade-deletes its own DashboardWidget rows (onDelete: Cascade).
  await prisma.dashboard.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.DASHBOARD_DELETED,
    entityType: ENTITY.DASHBOARD,
    entityId: id,
    changes: { before: { name: existing.name } },
  });
}

/** Widget management is gated by the parent Dashboard's own UPDATE permission — no separate per-widget RBAC. */
export async function createDashboardWidget(
  context: SessionContext,
  dashboardId: string,
  input: DashboardWidgetCreateInput,
) {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: dashboardId } });
  if (!dashboard) {
    throw new NotFoundError("Dashboard not found.");
  }
  await assertDashboardAccess(context, dashboard, "UPDATE");
  await assertKnownWidgetEntityType(input.entityType);

  const created = await prisma.dashboardWidget.create({
    data: {
      dashboardId,
      title: input.title,
      entityType: input.entityType,
      aggregate: input.aggregate,
      fieldKey: input.fieldKey,
      groupByKey: input.groupByKey,
      filters: input.filters as Prisma.InputJsonValue,
      sortOrder: input.sortOrder,
    },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.DASHBOARD_WIDGET_CREATED,
    entityType: ENTITY.DASHBOARD,
    entityId: dashboardId,
    changes: { after: { widgetId: created.id, title: created.title, entityType: created.entityType } },
  });

  return created;
}

export async function updateDashboardWidget(
  context: SessionContext,
  dashboardId: string,
  widgetId: string,
  input: DashboardWidgetUpdateInput,
) {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: dashboardId } });
  if (!dashboard) {
    throw new NotFoundError("Dashboard not found.");
  }
  await assertDashboardAccess(context, dashboard, "UPDATE");

  const existing = await prisma.dashboardWidget.findUnique({ where: { id: widgetId } });
  if (!existing || existing.dashboardId !== dashboardId) {
    throw new NotFoundError("Widget not found.");
  }

  if (input.entityType !== undefined) {
    await assertKnownWidgetEntityType(input.entityType);
  }

  const updated = await prisma.dashboardWidget.update({
    where: { id: widgetId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.entityType !== undefined && { entityType: input.entityType }),
      ...(input.aggregate !== undefined && { aggregate: input.aggregate }),
      ...(input.fieldKey !== undefined && { fieldKey: input.fieldKey }),
      ...(input.groupByKey !== undefined && { groupByKey: input.groupByKey }),
      ...(input.filters !== undefined && { filters: input.filters as Prisma.InputJsonValue }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.DASHBOARD_WIDGET_UPDATED,
    entityType: ENTITY.DASHBOARD,
    entityId: dashboardId,
    changes: { before: { widgetId: existing.id, title: existing.title }, after: { title: updated.title } },
  });

  return updated;
}

export async function deleteDashboardWidget(context: SessionContext, dashboardId: string, widgetId: string) {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: dashboardId } });
  if (!dashboard) {
    throw new NotFoundError("Dashboard not found.");
  }
  await assertDashboardAccess(context, dashboard, "UPDATE");

  const existing = await prisma.dashboardWidget.findUnique({ where: { id: widgetId } });
  if (!existing || existing.dashboardId !== dashboardId) {
    throw new NotFoundError("Widget not found.");
  }

  await prisma.dashboardWidget.delete({ where: { id: widgetId } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.DASHBOARD_WIDGET_DELETED,
    entityType: ENTITY.DASHBOARD,
    entityId: dashboardId,
    changes: { before: { widgetId: existing.id, title: existing.title } },
  });
}
