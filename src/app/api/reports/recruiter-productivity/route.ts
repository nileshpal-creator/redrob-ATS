import { withApiHandler } from "@/lib/api/handlers";
import { recruiterProductivityQuerySchema } from "@/lib/validations/report";
import { getRecruiterProductivityReport } from "@/lib/services/reports";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = recruiterProductivityQuerySchema.parse(params);
  return getRecruiterProductivityReport(context, query);
});
