import { withApiHandler } from "@/lib/api/handlers";
import { candidateNoteSchema } from "@/lib/validations/candidate";
import { addCandidateNote } from "@/lib/services/candidates";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = candidateNoteSchema.parse(await request.json());
  return addCandidateNote(context, params.id, input);
});
