import { withApiHandler } from "@/lib/api/handlers";
import { candidateUpdateSchema } from "@/lib/validations/candidate";
import { deleteCandidate, getCandidateById, updateCandidate } from "@/lib/services/candidates";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getCandidateById(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = candidateUpdateSchema.parse(await request.json());
  return updateCandidate(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteCandidate(context, params.id);
});
