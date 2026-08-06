import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api/handlers";
import { candidateExportQuerySchema } from "@/lib/validations/candidate";
import { exportCandidates } from "@/lib/services/candidate-export";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const query = candidateExportQuerySchema.parse({
    ...Object.fromEntries(searchParams),
    skills: searchParams.getAll("skills"),
    tags: searchParams.getAll("tags"),
  });

  const { buffer, mimeType, fileName } = await exportCandidates(context, query);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
