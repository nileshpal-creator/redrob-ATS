import { withApiHandler } from "@/lib/api/handlers";
import { candidateMergeSchema } from "@/lib/validations/candidate";
import { mergeCandidates } from "@/lib/services/candidates";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = candidateMergeSchema.parse(await request.json());
  return mergeCandidates(context, params.id, input);
});
