import { withApiHandler } from "@/lib/api/handlers";
import { candidateCreateSchema, candidateQuerySchema } from "@/lib/validations/candidate";
import { createCandidate, listCandidates } from "@/lib/services/candidates";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const query = candidateQuerySchema.parse({
    ...Object.fromEntries(searchParams),
    skills: searchParams.getAll("skills"),
    tags: searchParams.getAll("tags"),
  });
  return listCandidates(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = candidateCreateSchema.parse(await request.json());
  return createCandidate(context, input);
});
