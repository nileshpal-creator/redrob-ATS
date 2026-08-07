"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, MoveRight, UserX } from "lucide-react";

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
type Action = "STAGE_MOVE" | "REJECT" | "WITHDRAW";

/**
 * The application detail page's single-record equivalent of
 * BulkActionToolbar — same three mutating actions (stage move, reject,
 * withdraw), one at a time, with optimistic-lock conflicts and terminal-
 * outcome errors surfaced via toast + router.refresh() to resync.
 */
export function ApplicationTransitionActions({
  applicationId,
  jobId,
  currentStageId,
  version,
  rejectionReasons,
}: {
  applicationId: string;
  jobId: string;
  currentStageId: string;
  version: number;
  rejectionReasons: ReasonOption[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Action | null>(null);
  const [stages, setStages] = useState<StageOption[] | null>(null);
  const [toStageId, setToStageId] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (dialog !== "STAGE_MOVE") return;
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/pipeline-stages`)
      .then((response) => response.json())
      .then((data: StageOption[]) => {
        if (!cancelled) setStages(data.filter((stage) => stage.isActive && stage.id !== currentStageId));
      });
    return () => {
      cancelled = true;
    };
  }, [dialog, jobId, currentStageId]);

  function close() {
    setDialog(null);
    setStages(null);
    setToStageId("");
    setReasonId("");
    setNote("");
  }

  async function submit(action: Action) {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/applications/${applicationId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          version,
          ...(action === "STAGE_MOVE" ? { toStageId } : { reasonId }),
          ...(note ? { note } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to update application");
      }
      toast.success(
        action === "STAGE_MOVE" ? "Stage updated." : action === "REJECT" ? "Application rejected." : "Application withdrawn.",
      );
      close();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog("STAGE_MOVE")}>
          <MoveRight /> Move stage
        </Button>
        <Button variant="outline" onClick={() => setDialog("REJECT")}>
          <Ban /> Reject
        </Button>
        <Button variant="outline" onClick={() => setDialog("WITHDRAW")}>
          <UserX /> Withdraw
        </Button>
      </div>

      <Dialog open={dialog === "STAGE_MOVE"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move stage</DialogTitle>
            <DialogDescription>Choose the stage to move this application to.</DialogDescription>
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
            <Button disabled={!toStageId || submitting} onClick={() => submit("STAGE_MOVE")}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "REJECT" || dialog === "WITHDRAW"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "REJECT" ? "Reject" : "Withdraw"} this application</DialogTitle>
            <DialogDescription>
              A reason is required. This is terminal — the application cannot be moved or transitioned again.
            </DialogDescription>
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
              variant={dialog === "REJECT" ? "destructive" : "default"}
              disabled={!reasonId || submitting}
              onClick={() => dialog && submit(dialog)}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
