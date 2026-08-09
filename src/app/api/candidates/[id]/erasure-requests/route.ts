import { withApiHandler } from "@/lib/api/handlers";
import { dataErasureRequestCreateSchema } from "@/lib/validations/data-erasure";
import { listMyErasureRequestsForCandidate, requestCandidateErasure } from "@/lib/services/candidate-erasure";

type RouteParams = { id: string };

/** The caller's own erasure requests for this candidate — see listMyErasureRequestsForCandidate's own comment. */
export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return listMyErasureRequestsForCandidate(context, params.id);
});

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = dataErasureRequestCreateSchema.parse(await request.json());
  return requestCandidateErasure(context, params.id, input);
});
