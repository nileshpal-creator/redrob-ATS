import { withApiHandler } from "@/lib/api/handlers";
import { getDashboardData } from "@/lib/services/dashboards";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getDashboardData(context, params.id);
});
