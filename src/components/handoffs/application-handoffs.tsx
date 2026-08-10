"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCw, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Person = { id: string; name: string; email: string };

type HandoffStatus = "PENDING" | "DELIVERED" | "ACCEPTED" | "EXCEPTION";

type HandoffPayload = {
  candidate: { name: string; email: string | null };
  offer: { compensation: string; expectedJoiningDate: string | null };
  job: { title: string };
  documents: { id: string; fileName: string; documentType: string }[];
};

type DeliveryAttempt = {
  id: string;
  succeeded: boolean;
  externalReferenceId: string | null;
  errorMessage: string | null;
  attemptedBy: Person;
  attemptedAt: string;
};

export type Handoff = {
  id: string;
  status: HandoffStatus;
  deliveryMethod: "API_PUSH" | "STRUCTURED_EXPORT";
  exceptionReason: string | null;
  payload: HandoffPayload;
  initiatedBy: Person;
  acknowledgedBy: Person | null;
  acknowledgedAt: string | null;
  version: number;
  createdAt: string;
  attempts: DeliveryAttempt[];
  /** Computed server-side from HANDOFF:UPDATE — retry authority. */
  canRetry: boolean;
  /** Computed server-side from the HANDOFF:APPROVE grant — acknowledge authority. */
  canAcknowledge: boolean;
};

// Status-color legend (docs/design-system.md): warning=amber (waiting to
// deliver), info=blue (delivered, awaiting acknowledgement), success=green
// (accepted), destructive=red (delivery exception).
const STATUS_BADGE_VARIANT: Record<HandoffStatus, "warning" | "info" | "success" | "destructive"> = {
  PENDING: "warning",
  DELIVERED: "info",
  ACCEPTED: "success",
  EXCEPTION: "destructive",
};

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function ExceptionDialog({
  handoff,
  open,
  onOpenChange,
  onSaved,
}: {
  handoff: Handoff | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!handoff || !reason.trim()) return;
    setSubmitting(true);
    try {
      await requestJson(`/api/handoffs/${handoff.id}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ version: handoff.version, outcome: "EXCEPTION", exceptionReason: reason }),
      });
      toast.success("Exception recorded.");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record exception");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a handoff exception</DialogTitle>
          <DialogDescription>Describe what&apos;s wrong with the received package. This is recorded on the handoff.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={!reason.trim() || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Report exception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Onboarding handoff section for the Application detail page (§11.7). No
 * create action — a HandoffRecord only ever exists as a side effect of an
 * Offer reaching ACCEPTED (src/lib/services/offers.ts). `canRetry`/
 * `canAcknowledge` are computed server-side (same convention as Offer's
 * `canManage`/`canApprove`).
 */
export function ApplicationHandoffs({ handoffs }: { handoffs: Handoff[] }) {
  const router = useRouter();
  const [actingId, setActingId] = useState<string | null>(null);
  const [exceptionDialogFor, setExceptionDialogFor] = useState<Handoff | null>(null);

  function refresh() {
    router.refresh();
  }

  async function retry(handoff: Handoff) {
    setActingId(handoff.id);
    try {
      await requestJson(`/api/handoffs/${handoff.id}/retry`, {
        method: "POST",
        body: JSON.stringify({ version: handoff.version }),
      });
      toast.success("Delivery retried.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to retry delivery");
    } finally {
      setActingId(null);
    }
  }

  async function acknowledgeAccepted(handoff: Handoff) {
    setActingId(handoff.id);
    try {
      await requestJson(`/api/handoffs/${handoff.id}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ version: handoff.version, outcome: "ACCEPTED" }),
      });
      toast.success("Handoff acknowledged. This application is now archived.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to acknowledge handoff");
    } finally {
      setActingId(null);
    }
  }

  if (handoffs.length === 0) {
    return <p className="text-sm text-muted-foreground">No onboarding handoff yet — created automatically once an offer is accepted.</p>;
  }

  return (
    <div className="space-y-4">
      {handoffs.map((handoff, index) => (
        <div key={handoff.id}>
          {index > 0 ? <Separator className="mb-3" /> : null}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Onboarding package for {handoff.payload.candidate.name}</p>
              <Badge variant={STATUS_BADGE_VARIANT[handoff.status]}>{handoff.status}</Badge>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Delivery: {handoff.deliveryMethod.replace("_", " ").toLowerCase()}</span>
              <span>Initiated by {handoff.initiatedBy.name}</span>
              <span>{new Date(handoff.createdAt).toLocaleString()}</span>
            </p>

            {handoff.status === "EXCEPTION" && handoff.exceptionReason ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {handoff.exceptionReason}
              </p>
            ) : null}

            {handoff.acknowledgedBy ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserCheck className="size-3.5" />
                Acknowledged by {handoff.acknowledgedBy.name}
                {handoff.acknowledgedAt ? ` on ${new Date(handoff.acknowledgedAt).toLocaleString()}` : ""}
              </p>
            ) : null}

            <div className="space-y-1 rounded-md border p-2.5 text-xs">
              <p>
                Offer: {handoff.payload.offer.compensation}
                {handoff.payload.offer.expectedJoiningDate
                  ? ` · Joining ${new Date(handoff.payload.offer.expectedJoiningDate).toLocaleDateString()}`
                  : ""}
              </p>
              <p>Role: {handoff.payload.job.title}</p>
              <p className="flex items-center gap-1.5">
                <FileText className="size-3.5" />
                {handoff.payload.documents.length} document{handoff.payload.documents.length === 1 ? "" : "s"} included
              </p>
            </div>

            {handoff.attempts.length > 0 ? (
              <div className="space-y-1 rounded-md border p-2.5">
                {handoff.attempts.map((attempt) => (
                  <p key={attempt.id} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className={attempt.succeeded ? "size-3 text-primary" : "size-3 text-destructive"} />
                    <Badge variant={attempt.succeeded ? "secondary" : "destructive"}>
                      {attempt.succeeded ? "Delivered" : "Failed"}
                    </Badge>
                    <span className="text-muted-foreground">
                      {attempt.attemptedBy.name} &middot; {new Date(attempt.attemptedAt).toLocaleString()}
                    </span>
                    {attempt.errorMessage ? <span className="text-muted-foreground">— {attempt.errorMessage}</span> : null}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {handoff.status === "EXCEPTION" && handoff.canRetry ? (
                <Button size="sm" variant="outline" disabled={actingId === handoff.id} onClick={() => retry(handoff)}>
                  {actingId === handoff.id ? <Loader2 className="animate-spin" /> : <RotateCw />}
                  Retry delivery
                </Button>
              ) : null}
              {handoff.status === "DELIVERED" && handoff.canAcknowledge ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actingId === handoff.id}
                    onClick={() => acknowledgeAccepted(handoff)}
                  >
                    {actingId === handoff.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                    Confirm receipt
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setExceptionDialogFor(handoff)}>
                    Report exception
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      <ExceptionDialog
        handoff={exceptionDialogFor}
        open={exceptionDialogFor !== null}
        onOpenChange={(open) => !open && setExceptionDialogFor(null)}
        onSaved={refresh}
      />
    </div>
  );
}
