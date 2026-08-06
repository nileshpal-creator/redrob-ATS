"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
type Transition = { action: string; to: string; reasonRequired: boolean; reasonListKey?: string };

const ACTION_LABELS: Record<string, string> = {
  SUBMIT: "Submit for approval",
  APPROVE: "Approve",
  REJECT: "Reject",
  HOLD: "Put on hold",
  RESUME: "Resume",
  CLOSE: "Close",
  CANCEL: "Cancel",
};

const DESTRUCTIVE_ACTIONS = new Set(["REJECT", "CANCEL"]);

/**
 * One button per transition the viewer is currently allowed to perform,
 * computed server-side by getAvailableTransitions — this component never
 * decides who can do what, it only renders what the server already vetted.
 */
export function JobStatusActions({
  jobId,
  version,
  transitions,
  reasonsByListKey,
}: {
  jobId: string;
  version: number;
  transitions: Transition[];
  reasonsByListKey: Record<string, ReasonOption[]>;
}) {
  const router = useRouter();
  const [pendingTransition, setPendingTransition] = useState<Transition | null>(null);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function fire(transition: Transition, extra: { reasonId?: string; note?: string } = {}) {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: transition.action, version, ...extra }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to update status");
      }
      toast.success(`Job ${ACTION_LABELS[transition.action]?.toLowerCase() ?? "updated"}.`);
      setPendingTransition(null);
      setReasonId("");
      setNote("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClick(transition: Transition) {
    if (transition.reasonRequired) {
      setPendingTransition(transition);
    } else {
      fire(transition);
    }
  }

  const reasonOptions = pendingTransition?.reasonListKey
    ? reasonsByListKey[pendingTransition.reasonListKey] ?? []
    : [];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {transitions.map((transition) => (
          <Button
            key={transition.action}
            variant={DESTRUCTIVE_ACTIONS.has(transition.action) ? "outline" : "default"}
            onClick={() => handleClick(transition)}
            disabled={submitting}
          >
            {ACTION_LABELS[transition.action] ?? transition.action}
          </Button>
        ))}
      </div>

      <Dialog open={pendingTransition !== null} onOpenChange={(open) => !open && setPendingTransition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingTransition ? ACTION_LABELS[pendingTransition.action] : ""}</DialogTitle>
            <DialogDescription>A reason is required for this transition.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {reasonOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Optional note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!reasonId || submitting}
              onClick={() => pendingTransition && fire(pendingTransition, { reasonId, note: note || undefined })}
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
