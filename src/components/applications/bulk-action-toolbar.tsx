"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Ban, UserX, MoveRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
type TemplateOption = { id: string; name: string; isActive: boolean };
type SelectedRow = { id: string; version: number; job: { id: string; title: string } };

type BulkResult = { succeeded: unknown[]; failed: { id: string; reason: string }[] };
type EmailBulkResult = {
  succeeded: { status: "SENT" | "FAILED" }[];
  failed: { id: string; reason: string }[];
};

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

/** Email's own result mixes a delivery outcome into "succeeded" (a log row was created either way) — see bulkEmailApplications. */
function reportEmailResult(result: EmailBulkResult) {
  const sent = result.succeeded.filter((item) => item.status === "SENT").length;
  const deliveryFailed = result.succeeded.length - sent;
  const skipped = result.failed.length;

  if (deliveryFailed === 0 && skipped === 0) {
    toast.success(`Sent ${sent} email${sent === 1 ? "" : "s"}.`);
    return;
  }
  toast.warning(
    `Sent ${sent}, ${deliveryFailed} failed to deliver, ${skipped} skipped${
      result.failed[0] ? ` (${result.failed[0].reason})` : ""
    }.`,
  );
}

async function postJson<T = BulkResult>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as T;
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
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [templateId, setTemplateId] = useState("");

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

  useEffect(() => {
    if (dialog !== "email") return;
    let cancelled = false;
    fetch("/api/communication-templates?isActive=true")
      .then((response) => response.json())
      .then((data: TemplateOption[]) => {
        if (!cancelled) setTemplates(data);
      });
    return () => {
      cancelled = true;
    };
  }, [dialog]);

  function closeDialog() {
    setDialog(null);
    setStages(null);
    setToStageId("");
    setReasonId("");
    setNote("");
    setTemplates(null);
    setTemplateId("");
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
      const result = await postJson<EmailBulkResult>("/api/applications/bulk/email", {
        applicationIds: selectedRows.map((row) => row.id),
        templateId,
      });
      reportEmailResult(result);
      closeDialog();
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send email");
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
            <DialogDescription>Pick a template — it&apos;s rendered per candidate and sent immediately.</DialogDescription>
          </DialogHeader>
          {templates === null ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active templates yet. An admin can add one under Communication Templates.
            </p>
          ) : (
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button disabled={!templateId || submitting} onClick={runEmail}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
