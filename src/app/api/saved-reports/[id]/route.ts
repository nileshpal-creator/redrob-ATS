import { withApiHandler } from "@/lib/api/handlers";
import { savedReportUpdateSchema } from "@/lib/validations/report";
import { deleteSavedReport, getSavedReport, updateSavedReport } from "@/lib/services/saved-reports";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getSavedReport(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = savedReportUpdateSchema.parse(await request.json());
  return updateSavedReport(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteSavedReport(context, params.id);
});
