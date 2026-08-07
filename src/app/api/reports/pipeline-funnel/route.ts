import { withApiHandler } from "@/lib/api/handlers";
import { pipelineFunnelQuerySchema } from "@/lib/validations/report";
import { getPipelineFunnelReport } from "@/lib/services/reports";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = pipelineFunnelQuerySchema.parse(params);
  return getPipelineFunnelReport(context, query);
});
