import { withApiHandler } from "@/lib/api/handlers";
import { candidateImportCommitSchema } from "@/lib/validations/candidate";
import { commitCandidateImport } from "@/lib/services/candidate-import";

export const POST = withApiHandler(async (context, request) => {
  const input = candidateImportCommitSchema.parse(await request.json());
  return commitCandidateImport(context, input);
});
