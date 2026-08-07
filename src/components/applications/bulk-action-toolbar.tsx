"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Ban, UserX, MoveRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReasonOption = { id: string; label: string };
type StageOption = { id: string; name: string; isActive: boolean };
type SelectedRow = { id: string; version: number; job: { id: string; title: string } };

type BulkResult = { succeeded: unknown[]; failed: { id: string; reason: string }[] };

function reportResult(result: BulkResult, verb: string) {
  if (result.failed.length === 0) {
    toast.success(`${verb} ${result.succeeded.length} application${result.succeeded.length === 1 ? "" : "s"}.`);
    return;
  }
  toast.warning(
    `${verb} ${result.succeeded.length} application${result.succeeded.length === 1 ? "" : "s"}, ${
      result.failed.length
    } failed: ${result.failed[0]?.reason ?? "unknown error"}${result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : ""}`,
  );
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as BulkResult;
}

/**
 * Shared bulk-action toolbar for the global Applications list and the
 * per-job pipeline page (§11.4: "bulk actions" — limited to the four the
 * Phase 2 design approved: stage move, reject, withdraw, bulk email).
 * Stage move needs a single job's stage set, so it's disabled when the
 * current selection spans more than one job — a frontend-only guard; the
 * server would otherwise just report each cross-job row as a per-item
 * failure, which is safe but confusing.
 */
export function BulkActionToolbar({
  selectedRows,
  rejectionReasons,
  onDone,
}: {
  selectedRows: SelectedRow[];
  rejectionReasons: ReasonOption[];
  onDone: () => void;
}) {
  const [dialog, setDialog] = useState<"stage" | "reject" | "withdraw" | "email" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [stages, setStages] = useState<StageOption[] | null>(null);
  const [toStageId, setToStageId] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const jobIds = new Set(selectedRows.map((row) => row.job.id));
  const singleJobId = jobIds.size === 1 ? selectedRows[0]?.job.id : null;

  useEffect(() => {
    if (dialog !== "stage" || !singleJobId) return;
    let cancelled = false;
    fetch(`/api/jobs/${singleJobId}/pipeline-stages`)
      .then((response) => response.json())
      .then((data: StageOption[]) => {
        if (!cancelled) setStages(data.filter((stage) => stage.isActive));
      });
    return () => {
      cancelled = true;
    };
  }, [dialog, singleJobId]);

  function closeDialog() {
    setDialog(null);
    setStages(null);
    setToStageId("");
    setReasonId("");
    setNote("");
    setSubject("");
    setBody("");
  }

  async function runTransition(action: "STAGE_MOVE" | "REJECT" | "WITHDRAW") {
    setSubmitting(true);
    try {
      const applications = selectedRows.map((row) => ({ id: row.id, version: row.version }));
      const result = await postJson("/api/applications/bulk/transition", {
        action,
        applications,
        ...(action === "STAGE_MOVE" ? { toStageId } : { reasonId }),
        ...(note ? { note } : {}),
      });
      reportResult(result, action === "STAGE_MOVE" ? "Moved" : action === "REJECT" ? "Rejected" : "Withdrew");
      closeDialog();
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk action failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function runEmail() {
    setSubmitting(true);
    try {
      const result = await postJson("/api/applications/bulk/email", {
        applicationIds: selectedRows.map((row) => row.id),
        subject,
        body,
      });
      reportResult(result, "Queued email for");
      closeDialog();
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue email");
    } finally {
      setSubmitting(false);
    }
  }

  if (selectedRows.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">
        {selectedRows.length} selected
      </span>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!singleJobId}
          title={singleJobId ? undefined : "Select applications from a single job to move stage"}
          onClick={() => setDialog("stage")}
        >
          <MoveRight /> Move stage
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog("reject")}>
          <Ban /> Reject
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog("withdraw")}>
          <UserX /> Withdraw
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog("email")}>
          <Mail /> Email
        </Button>
      </div>

      <Dialog open={dialog === "stage"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedRows.length} applications</DialogTitle>
            <DialogDescription>Choose the target stage in this job&apos;s pipeline.</DialogDescription>
          </DialogHeader>
          {stages === null ? (
            <p className="text-sm text-muted-foreground">Loading stages…</p>
          ) : (
            <Select value={toStageId} onValueChange={setToStageId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button disabled={!toStageId || submitting} onClick={() => runTransition("STAGE_MOVE")}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "reject" || dialog === "withdraw"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "reject" ? "Reject" : "Withdraw"} {selectedRows.length} applications</DialogTitle>
            <DialogDescription>A reason is required. This cannot be undone for these applications.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {rejectionReasons.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea placeholder="Optional note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant={dialog === "reject" ? "destructive" : "default"}
              disabled={!reasonId || submitting}
              onClick={() => runTransition(dialog === "reject" ? "REJECT" : "WITHDRAW")}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "email"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email {selectedRows.length} applications</DialogTitle>
            <DialogDescription>
              Queued only — this records what would be sent. Real delivery ships with the Communication module.
              Use <code>{"{{candidate.name}}"}</code> and <code>{"{{job.title}}"}</code> as placeholders.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            <Textarea
              rows={5}
              placeholder="Body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button disabled={!subject.trim() || !body.trim() || submitting} onClick={runEmail}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Queue email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
