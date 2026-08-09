import { withApiHandler } from "@/lib/api/handlers";
import { ValidationError } from "@/lib/errors";
import { candidateImportColumnMappingSchema } from "@/lib/validations/candidate";
import { previewCandidateImport } from "@/lib/services/candidate-import";

export const POST = withApiHandler(async (context, request) => {
  const formData = await request.formData().catch(() => {
    throw new ValidationError("Expected a multipart/form-data request body.");
  });
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("A file is required.");
  }

  const mappingField = formData.get("mapping");
  const mapping = typeof mappingField === "string" ? candidateImportColumnMappingSchema.parse(JSON.parse(mappingField)) : undefined;

  const buffer = Buffer.from(await file.arrayBuffer());
  return previewCandidateImport(context, buffer, file.name, mapping);
});
