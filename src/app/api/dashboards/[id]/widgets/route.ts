import { withApiHandler } from "@/lib/api/handlers";
import { dashboardWidgetCreateSchema } from "@/lib/validations/dashboard";
import { createDashboardWidget } from "@/lib/services/dashboards";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = dashboardWidgetCreateSchema.parse(await request.json());
  return createDashboardWidget(context, params.id, input);
});
