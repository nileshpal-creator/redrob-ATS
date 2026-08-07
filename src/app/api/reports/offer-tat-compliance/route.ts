import { withApiHandler } from "@/lib/api/handlers";
import { offerTatComplianceQuerySchema } from "@/lib/validations/report";
import { getOfferTatComplianceReport } from "@/lib/services/reports";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = offerTatComplianceQuerySchema.parse(params);
  return getOfferTatComplianceReport(context, query);
});
