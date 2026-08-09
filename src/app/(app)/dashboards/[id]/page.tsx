import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { NotFoundError } from "@/lib/errors";
import { getDashboardData } from "@/lib/services/dashboards";
import { listWidgetEntityOptions } from "@/lib/reporting/dashboard-query";
import { DashboardDetailClient } from "@/components/dashboards/dashboard-detail-client";

export default async function DashboardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  // `dashboard.widgets` (via getDashboard's own include) are the raw,
  // editable widget definitions; `data` is each one's computed
  // DashboardWidgetResult, recomputed fresh against the caller's own RBAC
  // scope and field permissions on every request — never cached.
  const { dashboard, widgets: data } = await getDashboardData(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/dashboards");
    throw error;
  });

  // Mirrors WorkflowDetailPage's own two-path check — a Recruiting
  // Manager's TEAM-scope grant must still show the edit controls for a team
  // member's dashboard, not just the creator's own.
  const [canEditAll, canEditOwn] = await Promise.all([
    can(context, ENTITY.DASHBOARD, "UPDATE"),
    can(context, ENTITY.DASHBOARD, "UPDATE", { ownerId: dashboard.createdById }),
  ]);
  const canEdit = canEditAll || canEditOwn;
  // listWidgetEntityOptions itself requires DASHBOARD:CREATE — only fetched
  // when the widget-add form can actually be shown, so a read-only viewer
  // (e.g. Hiring Manager, READ-only) isn't denied loading the page itself.
  const entityOptions = canEdit ? await listWidgetEntityOptions(context) : [];

  const { widgets: widgetDefs, ...dashboardMeta } = dashboard;

  return (
    <DashboardDetailClient
      dashboard={JSON.parse(JSON.stringify(dashboardMeta))}
      widgets={JSON.parse(JSON.stringify(widgetDefs))}
      data={JSON.parse(JSON.stringify(data))}
      entityOptions={entityOptions}
      canEdit={canEdit}
    />
  );
}
