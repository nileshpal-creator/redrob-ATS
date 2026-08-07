import { withApiHandler } from "@/lib/api/handlers";
import { timeToFillOfferQuerySchema } from "@/lib/validations/report";
import { getTimeToFillOfferReport } from "@/lib/services/reports";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = timeToFillOfferQuerySchema.parse(params);
  return getTimeToFillOfferReport(context, query);
});
