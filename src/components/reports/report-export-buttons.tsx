"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

const FORMATS = ["XLSX", "CSV", "PDF"] as const;

export type ReportType = "PIPELINE_FUNNEL" | "TIME_TO_FILL_AND_OFFER" | "RECRUITER_PRODUCTIVITY" | "OFFER_TAT_COMPLIANCE";

/** Downloads reuse GET /api/reports/export — filters travel as a JSON-encoded query param, decoded server-side (see route.ts). */
export function ReportExportButtons({ reportType, filters }: { reportType: ReportType; filters: Record<string, unknown> }) {
  function download(format: (typeof FORMATS)[number]) {
    const params = new URLSearchParams({ reportType, format, filters: JSON.stringify(filters) });
    window.open(`/api/reports/export?${params.toString()}`, "_blank");
  }

  return (
    <div className="flex gap-2">
      {FORMATS.map((format) => (
        <Button key={format} type="button" variant="outline" size="sm" onClick={() => download(format)}>
          <Download className="size-3.5" /> {format}
        </Button>
      ))}
    </div>
  );
}
