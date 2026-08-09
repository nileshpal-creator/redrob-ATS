import { withApiHandler } from "@/lib/api/handlers";
import { dashboardCreateSchema } from "@/lib/validations/dashboard";
import { createDashboard, listDashboards } from "@/lib/services/dashboards";

export const GET = withApiHandler(async (context) => {
  return listDashboards(context);
});

export const POST = withApiHandler(async (context, request) => {
  const input = dashboardCreateSchema.parse(await request.json());
  return createDashboard(context, input);
});
