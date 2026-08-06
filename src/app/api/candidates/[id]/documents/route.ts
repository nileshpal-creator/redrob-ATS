import { withApiHandler } from "@/lib/api/handlers";
import { ValidationError } from "@/lib/errors";
import { candidateDocumentUploadSchema } from "@/lib/validations/candidate";
import { addCandidateDocument } from "@/lib/services/candidates";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("A file is required.");
  }

  const { documentTypeId } = candidateDocumentUploadSchema.parse({
    documentTypeId: formData.get("documentTypeId"),
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  return addCandidateDocument(context, params.id, {
    documentTypeId,
    fileName: file.name,
    mimeType: file.type,
    buffer,
  });
});
