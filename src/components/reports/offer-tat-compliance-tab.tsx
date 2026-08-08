"use client";

import { useState } from "react";
import { toast } from "sonner";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { ReportExportButtons } from "@/components/reports/report-export-buttons";
import { SaveReportDialog } from "@/components/reports/save-report-dialog";

type Option = { id: string; label: string };
type OfferRow = { offerId: string; recruiter: { id: string; name: string } | null; tatDays: number; compliant: boolean };
type Result = {
  tatThresholdDays: number;
  measuredCount: number;
  pendingApprovalCount: number;
  compliantCount: number;
  complianceRate: number | null;
  avgTatDays: number | null;
  rows: OfferRow[];
};

export function OfferTatComplianceTab({
  recruiters,
  defaultThresholdDays,
}: {
  recruiters: Option[];
  defaultThresholdDays: number;
}) {
  const [recruiterId, setRecruiterId] = useState("ANY");
  const [tatThresholdDays, setTatThresholdDays] = useState(String(defaultThresholdDays));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  function buildFilters(): Record<string, string> {
    return {
      ...(recruiterId !== "ANY" ? { recruiterId } : {}),
      tatThresholdDays,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
  }

  async function run() {
    setLoading(true);
    try {
      const params = new URLSearchParams(buildFilters());
      const response = await fetch(`/api/reports/offer-tat-compliance?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to run report");
      setResult(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run report");
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnDef<OfferRow, unknown>[] = [
    { header: "Offer ID", accessorKey: "offerId" },
    { header: "Recruiter", cell: ({ row }) => row.original.recruiter?.name ?? "—" },
    { header: "TAT (business days)", accessorKey: "tatDays" },
    {
      header: "Compliant",
      cell: ({ row }) => (
        <Badge variant={row.original.compliant ? "success" : "destructive"}>{row.original.compliant ? "Yes" : "No"}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Measures Offer submission to approval decision, in business days (using the org&apos;s working-day calendar).
        The threshold below defaults to the org-wide setting (Admin &rarr; Offer Settings) and can be overridden for
        this run only.
      </p>
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
          <label className="text-sm font-medium">Compliance threshold (business days)</label>
          <Input
            type="number"
            min={1}
            value={tatThresholdDays}
            onChange={(event) => setTatThresholdDays(event.target.value)}
            className="w-32"
          />
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
              {result.compliantCount}/{result.measuredCount} compliant (
              {result.complianceRate === null ? "—" : `${Math.round(result.complianceRate * 100)}%`}), avg TAT{" "}
              {result.avgTatDays === null ? "—" : `${result.avgTatDays.toFixed(1)}d`} — {result.pendingApprovalCount} offer(s)
              still awaiting an approval decision, not measurable yet.
            </p>
            <div className="flex gap-2">
              <ReportExportButtons reportType="OFFER_TAT_COMPLIANCE" filters={buildFilters()} />
              <SaveReportDialog reportType="OFFER_TAT_COMPLIANCE" filters={buildFilters()} />
            </div>
          </div>
          <DataTable columns={columns} data={result.rows} emptyMessage="No approved offers matched these filters." />
        </>
      ) : null}
    </div>
  );
}
