"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SavedReport = {
  id: string;
  name: string;
  reportType: string;
  scheduleFrequency: "NONE" | "DAILY" | "WEEKLY";
  recipientEmails: string[];
  exportFormat: "XLSX" | "CSV" | "PDF";
  lastRunAt: string | null;
  lastRunStatus: "SENT" | "FAILED" | null;
  version: number;
  createdBy: { name: string };
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  PIPELINE_FUNNEL: "Pipeline Funnel",
  TIME_TO_FILL_AND_OFFER: "Time to Fill & Offer",
  RECRUITER_PRODUCTIVITY: "Recruiter Productivity",
  OFFER_TAT_COMPLIANCE: "Offer TAT Compliance",
};

function EditScheduleDialog({
  report,
  open,
  onOpenChange,
  onSaved,
}: {
  report: SavedReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (report: SavedReport) => void;
}) {
  const [scheduleFrequency, setScheduleFrequency] = useState<"NONE" | "DAILY" | "WEEKLY">("NONE");
  const [recipientEmails, setRecipientEmails] = useState("");
  const [exportFormat, setExportFormat] = useState<"XLSX" | "CSV" | "PDF">("XLSX");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!report) return;
    setScheduleFrequency(report.scheduleFrequency);
    setRecipientEmails(report.recipientEmails.join(", "));
    setExportFormat(report.exportFormat);
  }, [report]);

  async function handleSubmit() {
    if (!report) return;
    setSubmitting(true);
    try {
      const emails = recipientEmails
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean);
      const response = await fetch(`/api/saved-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: report.version, scheduleFrequency, recipientEmails: emails, exportFormat }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to update report");
      onSaved(body);
      toast.success(`"${body.name}" updated.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule &quot;{report?.name}&quot;</DialogTitle>
          <DialogDescription>
            Email delivery requires an external scheduler to actually trigger it on a cadence — see the Reports
            module notes. Recipients are comma-separated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Frequency</label>
            <Select value={scheduleFrequency} onValueChange={(value) => setScheduleFrequency(value as typeof scheduleFrequency)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Not scheduled</SelectItem>
                <SelectItem value="DAILY">Daily</SelectItem>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Recipient emails</label>
            <Input value={recipientEmails} onChange={(event) => setRecipientEmails(event.target.value)} placeholder="a@x.com, b@x.com" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Export format</label>
            <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as typeof exportFormat)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="XLSX">Excel (XLSX)</SelectItem>
                <SelectItem value="CSV">CSV</SelectItem>
                <SelectItem value="PDF">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SavedReportsTab() {
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [editing, setEditing] = useState<SavedReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/saved-reports")
      .then((response) => response.json())
      .then((data: SavedReport[]) => {
        if (!cancelled) setReports(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(report: SavedReport) {
    if (!window.confirm(`Delete "${report.name}"? This can't be undone.`)) return;
    try {
      const response = await fetch(`/api/saved-reports/${report.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Failed to delete report");
      }
      setReports((prev) => prev?.filter((row) => row.id !== report.id) ?? null);
      toast.success(`"${report.name}" deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete report");
    }
  }

  if (reports === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  const columns: ColumnDef<SavedReport, unknown>[] = [
    { header: "Name", accessorKey: "name" },
    { header: "Type", cell: ({ row }) => REPORT_TYPE_LABELS[row.original.reportType] ?? row.original.reportType },
    { header: "Owner", cell: ({ row }) => row.original.createdBy.name },
    {
      header: "Schedule",
      cell: ({ row }) =>
        row.original.scheduleFrequency === "NONE" ? (
          <span className="text-muted-foreground">Not scheduled</span>
        ) : (
          <Badge variant="secondary">{row.original.scheduleFrequency}</Badge>
        ),
    },
    {
      header: "Last run",
      cell: ({ row }) =>
        row.original.lastRunAt ? (
          <Badge variant={row.original.lastRunStatus === "SENT" ? "success" : "destructive"}>
            {new Date(row.original.lastRunAt).toLocaleDateString()} — {row.original.lastRunStatus}
          </Badge>
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(row.original)}>
            Schedule
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleDelete(row.original)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={reports}
        emptyMessage='No saved reports yet — use "Save as report" from any report tab.'
      />
      <EditScheduleDialog
        report={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(updated) => setReports((prev) => prev?.map((row) => (row.id === updated.id ? updated : row)) ?? null)}
      />
    </div>
  );
}
