import { withApiHandler } from "@/lib/api/handlers";
import { dashboardUpdateSchema } from "@/lib/validations/dashboard";
import { deleteDashboard, getDashboard, updateDashboard } from "@/lib/services/dashboards";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getDashboard(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = dashboardUpdateSchema.parse(await request.json());
  return updateDashboard(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteDashboard(context, params.id);
});
