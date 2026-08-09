import { withApiHandler } from "@/lib/api/handlers";
import { dataErasureRequestCreateSchema } from "@/lib/validations/data-erasure";
import { requestCandidateErasure } from "@/lib/services/candidate-erasure";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = dataErasureRequestCreateSchema.parse(await request.json());
  return requestCandidateErasure(context, params.id, input);
});
