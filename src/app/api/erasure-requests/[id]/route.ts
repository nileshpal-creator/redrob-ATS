import { withApiHandler } from "@/lib/api/handlers";
import { dataErasureRequestDecideSchema } from "@/lib/validations/data-erasure";
import { decideCandidateErasureRequest } from "@/lib/services/candidate-erasure";

type RouteParams = { id: string };

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = dataErasureRequestDecideSchema.parse(await request.json());
  return decideCandidateErasureRequest(context, params.id, input);
});
