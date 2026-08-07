import { withApiHandler } from "@/lib/api/handlers";
import { savedReportCreateSchema, savedReportQuerySchema } from "@/lib/validations/report";
import { createSavedReport, listSavedReports } from "@/lib/services/saved-reports";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = savedReportQuerySchema.parse(params);
  return listSavedReports(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = savedReportCreateSchema.parse(await request.json());
  return createSavedReport(context, input);
});
