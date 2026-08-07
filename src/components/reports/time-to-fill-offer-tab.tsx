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
type JobRow = {
  jobId: string;
  title: string;
  departmentLabel: string;
  timeToFillDaysAvg: number | null;
  hiresCount: number;
  timeToOfferDaysAvg: number | null;
  offersCount: number;
};
type Result = { jobs: JobRow[]; overall: { timeToFillDaysAvg: number | null; hiresCount: number; timeToOfferDaysAvg: number | null; offersCount: number } };

function formatDays(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}d`;
}

export function TimeToFillOfferTab({ departments, locations, recruiters }: { departments: Option[]; locations: Option[]; recruiters: Option[] }) {
  const [departmentId, setDepartmentId] = useState("ANY");
  const [locationId, setLocationId] = useState("ANY");
  const [recruiterId, setRecruiterId] = useState("ANY");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  function buildFilters(): Record<string, string> {
    return {
      ...(departmentId !== "ANY" ? { departmentId } : {}),
      ...(locationId !== "ANY" ? { locationId } : {}),
      ...(recruiterId !== "ANY" ? { recruiterId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
  }

  async function run() {
    setLoading(true);
    try {
      const params = new URLSearchParams(buildFilters());
      const response = await fetch(`/api/reports/time-to-fill-offer?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to run report");
      setResult(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run report");
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnDef<JobRow, unknown>[] = [
    { header: "Job", accessorKey: "title" },
    { header: "Department", accessorKey: "departmentLabel" },
    { header: "Time to Fill (avg)", cell: ({ row }) => formatDays(row.original.timeToFillDaysAvg) },
    { header: "Hires", accessorKey: "hiresCount" },
    { header: "Time to Offer (avg)", cell: ({ row }) => formatDays(row.original.timeToOfferDaysAvg) },
    { header: "Offers", accessorKey: "offersCount" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Department</label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any department</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Location</label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any location</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.label}
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
              Overall: {formatDays(result.overall.timeToFillDaysAvg)} avg time to fill ({result.overall.hiresCount} hires),{" "}
              {formatDays(result.overall.timeToOfferDaysAvg)} avg time to offer ({result.overall.offersCount} offers)
            </p>
            <div className="flex gap-2">
              <ReportExportButtons reportType="TIME_TO_FILL_AND_OFFER" filters={buildFilters()} />
              <SaveReportDialog reportType="TIME_TO_FILL_AND_OFFER" filters={buildFilters()} />
            </div>
          </div>
          <DataTable columns={columns} data={result.jobs} emptyMessage="No jobs matched these filters." />
        </>
      ) : null}
    </div>
  );
}
