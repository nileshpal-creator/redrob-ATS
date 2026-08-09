import { withApiHandler } from "@/lib/api/handlers";
import { dashboardWidgetUpdateSchema } from "@/lib/validations/dashboard";
import { deleteDashboardWidget, updateDashboardWidget } from "@/lib/services/dashboards";

type RouteParams = { id: string; widgetId: string };

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = dashboardWidgetUpdateSchema.parse(await request.json());
  return updateDashboardWidget(context, params.id, params.widgetId, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteDashboardWidget(context, params.id, params.widgetId);
});
