import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listDashboards } from "@/lib/services/dashboards";
import { DashboardsListClient } from "@/components/dashboards/dashboards-list-client";

export default async function DashboardsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.DASHBOARD, "READ");

  const [dashboards, canCreate] = await Promise.all([
    listDashboards(context),
    can(context, ENTITY.DASHBOARD, "CREATE"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboards</h1>
        <p className="text-muted-foreground">
          Build custom dashboards over any entity — including custom objects and fields (§10.5). Every widget is
          recomputed against your own role and field permissions each time you view it.
        </p>
      </div>
      <DashboardsListClient dashboards={JSON.parse(JSON.stringify(dashboards))} canCreate={canCreate} />
    </div>
  );
}
