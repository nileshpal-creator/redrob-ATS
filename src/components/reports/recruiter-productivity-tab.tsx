"use client";

import { useState } from "react";
import { toast } from "sonner";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { ReportExportButtons } from "@/components/reports/report-export-buttons";
import { SaveReportDialog } from "@/components/reports/save-report-dialog";

type Option = { id: string; label: string };
type RecruiterRow = {
  recruiter: { id: string; name: string; email: string };
  openJobsCount: number;
  activeApplicationsCount: number;
  interviewsScheduledCount: number;
  offersExtendedCount: number;
  hiresCount: number;
};
type Result = { rows: RecruiterRow[] };

export function RecruiterProductivityTab({ recruiters }: { recruiters: Option[] }) {
  const [recruiterId, setRecruiterId] = useState("ANY");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  function buildFilters(): Record<string, string> {
    return {
      ...(recruiterId !== "ANY" ? { recruiterId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
  }

  async function run() {
    setLoading(true);
    try {
      const params = new URLSearchParams(buildFilters());
      const response = await fetch(`/api/reports/recruiter-productivity?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to run report");
      setResult(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run report");
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnDef<RecruiterRow, unknown>[] = [
    { header: "Recruiter", cell: ({ row }) => row.original.recruiter.name },
    { header: "Open Jobs", accessorKey: "openJobsCount" },
    { header: "Active Applications", accessorKey: "activeApplicationsCount" },
    { header: "Interviews Scheduled", accessorKey: "interviewsScheduledCount" },
    { header: "Offers Extended", accessorKey: "offersExtendedCount" },
    { header: "Hires", accessorKey: "hiresCount" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Recruiter</label>
          <Select value={recruiterId} onValueChange={setRecruiterId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">All visible recruiters</SelectItem>
              {recruiters.map((recruiter) => (
                <SelectItem key={recruiter.id} value={recruiter.id}>
                  {recruiter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-40" />
        </div>
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Run
        </Button>
      </div>

      {result ? (
        <>
          <div className="flex justify-end gap-2">
            <ReportExportButtons reportType="RECRUITER_PRODUCTIVITY" filters={buildFilters()} />
            <SaveReportDialog reportType="RECRUITER_PRODUCTIVITY" filters={buildFilters()} />
          </div>
          <DataTable columns={columns} data={result.rows} emptyMessage="No recruiters visible to your role." />
        </>
      ) : null}
    </div>
  );
}
