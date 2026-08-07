"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BookmarkPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ReportType } from "@/components/reports/report-export-buttons";

/** Saves the current tab's filters as a SavedReport (§10.5) — scheduling itself happens later, from the Saved Reports tab. */
export function SaveReportDialog({ reportType, filters }: { reportType: ReportType; filters: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reportType, filters }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save report");
      toast.success(`Saved report "${body.name}" created.`);
      setOpen(false);
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <BookmarkPlus className="size-3.5" /> Save as report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view as a report</DialogTitle>
          <DialogDescription>
            Saves these filters so you (and your team, depending on your role&apos;s scope) can re-run or schedule
            them later from the Saved Reports tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekly funnel — Engineering" />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
