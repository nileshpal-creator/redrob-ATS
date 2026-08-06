import { withApiHandler } from "@/lib/api/handlers";
import { candidateDuplicateCheckSchema } from "@/lib/validations/candidate";
import { checkCandidateDuplicates } from "@/lib/services/candidates";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const input = candidateDuplicateCheckSchema.parse(Object.fromEntries(searchParams));
  return checkCandidateDuplicates(context, input);
});
