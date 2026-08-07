import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api/handlers";
import { reportExportQuerySchema } from "@/lib/validations/report";
import { exportReport } from "@/lib/services/report-export";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const rawFilters = searchParams.get("filters");
  const query = reportExportQuerySchema.parse({
    reportType: searchParams.get("reportType"),
    format: searchParams.get("format"),
    filters: rawFilters ? JSON.parse(rawFilters) : {},
  });

  const { buffer, mimeType, fileName } = await exportReport(context, query);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
