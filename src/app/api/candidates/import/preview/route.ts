import { withApiHandler } from "@/lib/api/handlers";
import { ValidationError } from "@/lib/errors";
import { previewCandidateImport } from "@/lib/services/candidate-import";

export const POST = withApiHandler(async (context, request) => {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("A file is required.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return previewCandidateImport(context, buffer, file.name);
});
