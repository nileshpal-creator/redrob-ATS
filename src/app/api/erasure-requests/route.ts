import { withApiHandler } from "@/lib/api/handlers";
import { dataErasureRequestQuerySchema } from "@/lib/validations/data-erasure";
import { listCandidateErasureRequests } from "@/lib/services/candidate-erasure";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = dataErasureRequestQuerySchema.parse(params);
  return listCandidateErasureRequests(context, query);
});
