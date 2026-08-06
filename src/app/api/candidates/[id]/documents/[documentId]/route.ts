import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api/handlers";
import { deleteCandidateDocument, getCandidateDocumentForDownload } from "@/lib/services/candidates";

type RouteParams = { id: string; documentId: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  const { document, buffer } = await getCandidateDocumentForDownload(context, params.id, params.documentId);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${document.fileName}"`,
    },
  });
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteCandidateDocument(context, params.id, params.documentId);
});
