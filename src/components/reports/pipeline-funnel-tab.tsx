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
type StageRow = { stageId: string; name: string; currentCount: number; reachedCount: number; conversionFromPrevious: number | null };
type FunnelResult = { job: { id: string; title: string }; totalApplications: number; stages: StageRow[] };

export function PipelineFunnelTab({ jobs, recruiters, sources }: { jobs: Option[]; recruiters: Option[]; sources: Option[] }) {
  const [jobId, setJobId] = useState("ANY");
  const [recruiterId, setRecruiterId] = useState("ANY");
  const [sourceId, setSourceId] = useState("ANY");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [loading, setLoading] = useState(false);

  function buildFilters(): Record<string, string> {
    return {
      jobId,
      ...(recruiterId !== "ANY" ? { recruiterId } : {}),
      ...(sourceId !== "ANY" ? { sourceId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
  }

  async function run() {
    if (jobId === "ANY") {
      toast.error("Select a job — the funnel is scoped to one job's own pipeline stages.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams(buildFilters());
      const response = await fetch(`/api/reports/pipeline-funnel?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to run report");
      setResult(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run report");
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnDef<StageRow, unknown>[] = [
    { header: "Stage", accessorKey: "name" },
    { header: "Current", accessorKey: "currentCount" },
    { header: "Reached", accessorKey: "reachedCount" },
    {
      header: "Conversion from previous",
      cell: ({ row }) =>
        row.original.conversionFromPrevious === null ? "—" : `${Math.round(row.original.conversionFromPrevious * 100)}%`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Job</label>
          <Select value={jobId} onValueChange={setJobId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select a job" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Select a job</SelectItem>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Recruiter</label>
          <Select value={recruiterId} onValueChange={setRecruiterId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any recruiter</SelectItem>
              {recruiters.map((recruiter) => (
                <SelectItem key={recruiter.id} value={recruiter.id}>
                  {recruiter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Source</label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any source</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {result.job.title} — {result.totalApplications} application(s) matched
            </p>
            <div className="flex gap-2">
              <ReportExportButtons reportType="PIPELINE_FUNNEL" filters={buildFilters()} />
              <SaveReportDialog reportType="PIPELINE_FUNNEL" filters={buildFilters()} />
            </div>
          </div>
          <DataTable columns={columns} data={result.stages} emptyMessage="No active pipeline stages configured for this job." />
        </>
      ) : null}
    </div>
  );
}
