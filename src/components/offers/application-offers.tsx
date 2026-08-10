"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Clock, Loader2, MinusCircle, Plus, Wallet, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";

type Person = { id: string; name: string; email: string };
type ReasonOption = { id: string; label: string };

type OfferStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXTENDED"
  | "ACCEPTED"
  | "DECLINED"
  | "REVOKED"
  | "LAPSED";

type OfferApprovalEntry = {
  id: string;
  stepOrder: number;
  stepName: string | null;
  requiredRoleName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
  approver: Person | null;
  comments: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type Offer = {
  id: string;
  compensation: string;
  expectedJoiningDate: string | null;
  designation: string | null;
  location: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  status: OfferStatus;
  outcomeReason: { label: string } | null;
  createdBy: Person;
  approvals: OfferApprovalEntry[];
  version: number;
  createdAt: string;
  /** Computed server-side from createdById — edit/submit/extend/accept/decline/revoke authority. */
  canManage: boolean;
  /** Computed server-side from the OFFER:APPROVE grant — approve/reject authority. */
  canApprove: boolean;
};

// Status-color legend (docs/design-system.md): success=green (the desired
// outcome), warning=amber (waiting on an internal decision), info=blue
// (waiting on the candidate), attention=orange (timed out, needs a nudge —
// distinct from a hard decline), destructive=red (terminal negative).
const STATUS_BADGE_VARIANT: Record<
  OfferStatus,
  "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "attention"
> = {
  DRAFT: "outline",
  PENDING_APPROVAL: "warning",
  APPROVED: "secondary",
  EXTENDED: "info",
  ACCEPTED: "success",
  DECLINED: "destructive",
  REVOKED: "destructive",
  LAPSED: "attention",
};

const APPROVAL_STATUS_BADGE_VARIANT: Record<
  OfferApprovalEntry["status"],
  "secondary" | "destructive" | "success" | "warning"
> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  SKIPPED: "secondary",
};

const APPROVAL_STATUS_ICON: Record<OfferApprovalEntry["status"], typeof CheckCircle2> = {
  PENDING: Clock,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  SKIPPED: MinusCircle,
};

// Mirrors NON_TERMINAL_STATUSES in src/lib/services/offers.ts — kept as a
// separate constant (not imported) since this is a client component and
// that file is server-only, but the two must be kept in sync by hand.
const NON_TERMINAL_STATUSES: OfferStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "EXTENDED"];

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

function toDateInputValue(iso: string) {
  return iso.slice(0, 10);
}

/** Explains why "Review approval" is hidden — the caller can approve/reject but not decide this specific step. */
function currentPendingStepLabel(approvals: OfferApprovalEntry[]) {
  const pending = approvals.filter((approval) => approval.status === "PENDING");
  if (pending.length === 0) return null;
  const current = pending.reduce((min, approval) => (approval.stepOrder < min.stepOrder ? approval : min));
  return current.requiredRoleName
    ? `Awaiting ${current.stepName ?? "approval"} — requires the ${current.requiredRoleName} role.`
    : "Awaiting approval.";
}

type OfferFormValues = {
  compensation: string;
  expectedJoiningDate: string;
  designation: string;
  location: string;
  notes: string;
  customFields: Record<string, unknown>;
};

const EMPTY_OFFER_FORM: OfferFormValues = {
  compensation: "",
  expectedJoiningDate: "",
  designation: "",
  location: "",
  notes: "",
  customFields: {},
};

function OfferFormDialog({
  applicationId,
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  applicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { offer: Offer } | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<OfferFormValues>(EMPTY_OFFER_FORM);
  const [submitting, setSubmitting] = useState(false);

  const editingOffer = initial?.offer ?? null;
  const editingId = editingOffer?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setValues(
      editingOffer
        ? {
            compensation: editingOffer.compensation,
            expectedJoiningDate: editingOffer.expectedJoiningDate ? toDateInputValue(editingOffer.expectedJoiningDate) : "",
            designation: editingOffer.designation ?? "",
            location: editingOffer.location ?? "",
            notes: editingOffer.notes ?? "",
            customFields: editingOffer.customFields ?? {},
          }
        : EMPTY_OFFER_FORM,
    );
    // Reset only when the dialog opens or which offer it targets changes —
    // not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  function update<K extends keyof OfferFormValues>(key: K, value: OfferFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    const compensation = Number(values.compensation);
    if (!values.compensation || Number.isNaN(compensation) || compensation <= 0) {
      toast.error("Enter a valid compensation amount.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        compensation,
        expectedJoiningDate: values.expectedJoiningDate || undefined,
        designation: values.designation || undefined,
        location: values.location || undefined,
        notes: values.notes || undefined,
        customFields: values.customFields,
      };

      if (editingOffer) {
        await requestJson(`/api/offers/${editingOffer.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, version: editingOffer.version }),
        });
        toast.success("Offer updated.");
      } else {
        await requestJson("/api/offers", {
          method: "POST",
          body: JSON.stringify({ ...payload, applicationId }),
        });
        toast.success("Offer created.");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save offer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingOffer ? "Edit offer" : "Create offer"}</DialogTitle>
          <DialogDescription>
            {editingOffer ? "Update the draft terms before submitting for approval." : "Draft an offer for this application."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Compensation</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={values.compensation}
                onChange={(event) => update("compensation", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Expected joining date (optional)</Label>
              <Input
                type="date"
                value={values.expectedJoiningDate}
                onChange={(event) => update("expectedJoiningDate", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Designation (optional)</Label>
              <Input value={values.designation} onChange={(event) => update("designation", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Location (optional)</Label>
              <Input value={values.location} onChange={(event) => update("location", event.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea rows={3} value={values.notes} onChange={(event) => update("notes", event.target.value)} />
          </div>

          <CustomFieldsFormSection
            entityType="OFFER"
            value={values.customFields}
            onChange={(next) => update("customFields", next)}
          />
        </div>
        <DialogFooter>
          <Button disabled={submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {editingOffer ? "Save changes" : "Create offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalDialog({
  offer,
  open,
  onOpenChange,
  onSaved,
}: {
  offer: Offer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState<"APPROVE" | "REJECT" | null>(null);

  useEffect(() => {
    if (open) setComments("");
  }, [open]);

  async function decide(action: "APPROVE" | "REJECT") {
    if (!offer) return;
    setSubmitting(action);
    try {
      await requestJson(`/api/offers/${offer.id}/status`, {
        method: "POST",
        body: JSON.stringify({ action, version: offer.version, comments: comments || undefined }),
      });
      toast.success(action === "APPROVE" ? "Offer approved." : "Offer sent back to draft.");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record decision");
    } finally {
      setSubmitting(null);
    }
  }

  const currentStep = offer
    ? offer.approvals
        .filter((approval) => approval.status === "PENDING")
        .reduce((min, approval) => (!min || approval.stepOrder < min.stepOrder ? approval : min), null as OfferApprovalEntry | null)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentStep?.stepName ? `Review: ${currentStep.stepName}` : "Review offer for approval"}</DialogTitle>
          <DialogDescription>
            Compensation: {offer?.compensation} &middot; Drafted by {offer?.createdBy.name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Comments (optional)</Label>
          <Textarea
            rows={3}
            placeholder="Visible on the approval record"
            value={comments}
            onChange={(event) => setComments(event.target.value)}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={submitting !== null} onClick={() => decide("REJECT")}>
            {submitting === "REJECT" ? <Loader2 className="animate-spin" /> : null}
            Reject
          </Button>
          <Button disabled={submitting !== null} onClick={() => decide("APPROVE")}>
            {submitting === "APPROVE" ? <Loader2 className="animate-spin" /> : null}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeDialog({
  offer,
  action,
  outcomeReasons,
  open,
  onOpenChange,
  onSaved,
}: {
  offer: Offer | null;
  action: "DECLINE" | "REVOKE";
  outcomeReasons: ReasonOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setReasonId("");
  }, [open]);

  async function handleSubmit() {
    if (!offer || !reasonId) return;
    setSubmitting(true);
    try {
      await requestJson(`/api/offers/${offer.id}/status`, {
        method: "POST",
        body: JSON.stringify({ action, version: offer.version, reasonId }),
      });
      toast.success(action === "DECLINE" ? "Offer declined." : "Offer revoked.");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save decision");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "DECLINE" ? "Decline offer" : "Revoke offer"}</DialogTitle>
          <DialogDescription>A reason is required. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <Select value={reasonId} onValueChange={setReasonId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a reason" />
          </SelectTrigger>
          <SelectContent>
            {outcomeReasons.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="destructive" disabled={!reasonId || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {action === "DECLINE" ? "Confirm decline" : "Confirm revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ActiveDialog =
  | { type: "CREATE" }
  | { type: "EDIT"; offer: Offer }
  | { type: "APPROVAL"; offer: Offer }
  | { type: "DECLINE"; offer: Offer }
  | { type: "REVOKE"; offer: Offer }
  | null;

/**
 * Offer scheduling/list section for the Application detail page (§11.6).
 * `canCreate`, and each offer's `canManage`/`canApprove`, are computed
 * server-side (same convention as Interview's `canManage`) — `canManage`
 * mirrors assertOfferAccess against OFFER:UPDATE, `canApprove` the same
 * against OFFER:APPROVE, since Offer's approval step is a distinct
 * permission from editing/progressing it (a Recruiter with UPDATE:OWN
 * can submit/extend/accept/decline/revoke their own offer but can never
 * approve it — that needs a separate OFFER:APPROVE grant).
 */
export function ApplicationOffers({
  applicationId,
  offers,
  canCreate,
  outcomeReasons,
}: {
  applicationId: string;
  offers: Offer[];
  canCreate: boolean;
  outcomeReasons: ReasonOption[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  async function handleSimpleAction(offer: Offer, action: "SUBMIT" | "EXTEND" | "ACCEPT", successMessage: string) {
    setActingId(offer.id);
    try {
      await requestJson(`/api/offers/${offer.id}/status`, {
        method: "POST",
        body: JSON.stringify({ action, version: offer.version }),
      });
      toast.success(successMessage);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update offer");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {canCreate && offers.every((offer) => !NON_TERMINAL_STATUSES.includes(offer.status)) ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setDialog({ type: "CREATE" })}>
            <Plus /> Create offer
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {offers.map((offer, index) => (
          <div key={offer.id}>
            {index > 0 ? <Separator className="mb-3" /> : null}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-sm font-medium">
                  <Wallet className="size-3.5" />
                  {offer.compensation}
                </p>
                <Badge variant={STATUS_BADGE_VARIANT[offer.status]}>{offer.status.replace("_", " ")}</Badge>
              </div>
              {offer.designation ? <p className="text-sm font-medium">{offer.designation}</p> : null}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {offer.expectedJoiningDate ? (
                  <span className="flex items-center gap-1">
                    <CalendarClock className="size-3.5" />
                    Joining {new Date(offer.expectedJoiningDate).toLocaleDateString()}
                  </span>
                ) : null}
                {offer.location ? <span>{offer.location}</span> : null}
                <span>Drafted by {offer.createdBy.name}</span>
              </p>
              {(offer.status === "DECLINED" || offer.status === "REVOKED") && offer.outcomeReason ? (
                <p className="text-xs text-muted-foreground">Reason: {offer.outcomeReason.label}</p>
              ) : null}
              {offer.notes ? <p className="text-sm text-muted-foreground">{offer.notes}</p> : null}

              {offer.approvals.length > 0 ? (
                <div className="space-y-1 rounded-md border p-2.5">
                  {offer.approvals.map((approval) => {
                    const ApprovalIcon = APPROVAL_STATUS_ICON[approval.status];
                    return (
                    <p key={approval.id} className="flex items-center gap-2 text-xs">
                      <ApprovalIcon className="size-3" />
                      {approval.stepName ? <span className="font-medium">{approval.stepName}</span> : null}
                      <span className={approval.stepName ? "text-muted-foreground" : "font-medium"}>
                        {approval.approver?.name ?? "Pending"}
                      </span>
                      <Badge variant={APPROVAL_STATUS_BADGE_VARIANT[approval.status]}>{approval.status}</Badge>
                      {approval.status === "PENDING" && approval.requiredRoleName ? (
                        <span className="text-muted-foreground">requires {approval.requiredRoleName}</span>
                      ) : null}
                      {approval.comments ? <span className="text-muted-foreground">— {approval.comments}</span> : null}
                    </p>
                    );
                  })}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {offer.status === "DRAFT" && offer.canManage ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ type: "EDIT", offer })}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === offer.id}
                      onClick={() => handleSimpleAction(offer, "SUBMIT", "Offer submitted for approval.")}
                    >
                      {actingId === offer.id ? <Loader2 className="animate-spin" /> : null}
                      Submit for approval
                    </Button>
                  </>
                ) : null}
                {offer.status === "PENDING_APPROVAL" && offer.canApprove ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ type: "APPROVAL", offer })}>
                    Review approval
                  </Button>
                ) : null}
                {offer.status === "PENDING_APPROVAL" && !offer.canApprove ? (
                  <p className="self-center text-xs text-muted-foreground">
                    {currentPendingStepLabel(offer.approvals)}
                  </p>
                ) : null}
                {offer.status === "APPROVED" && offer.canManage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actingId === offer.id}
                    onClick={() => handleSimpleAction(offer, "EXTEND", "Offer extended to the candidate.")}
                  >
                    {actingId === offer.id ? <Loader2 className="animate-spin" /> : null}
                    Extend to candidate
                  </Button>
                ) : null}
                {offer.status === "EXTENDED" && offer.canManage ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === offer.id}
                      onClick={() => handleSimpleAction(offer, "ACCEPT", "Offer accepted.")}
                    >
                      {actingId === offer.id ? <Loader2 className="animate-spin" /> : null}
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ type: "DECLINE", offer })}>
                      Decline
                    </Button>
                  </>
                ) : null}
                {NON_TERMINAL_STATUSES.includes(offer.status) && offer.canManage ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ type: "REVOKE", offer })}>
                    Revoke
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
        {offers.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No offers yet"
            description="Extend an offer once this candidate is ready to move forward."
            size="sm"
            action={canCreate ? { label: "New offer", onClick: () => setDialog({ type: "CREATE" }) } : undefined}
          />
        ) : null}
      </div>

      <OfferFormDialog
        applicationId={applicationId}
        open={dialog?.type === "CREATE" || dialog?.type === "EDIT"}
        onOpenChange={(open) => !open && setDialog(null)}
        initial={dialog?.type === "EDIT" ? { offer: dialog.offer } : null}
        onSaved={refresh}
      />
      <ApprovalDialog
        offer={dialog?.type === "APPROVAL" ? dialog.offer : null}
        open={dialog?.type === "APPROVAL"}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={refresh}
      />
      <OutcomeDialog
        offer={dialog?.type === "DECLINE" || dialog?.type === "REVOKE" ? dialog.offer : null}
        action={dialog?.type === "REVOKE" ? "REVOKE" : "DECLINE"}
        outcomeReasons={outcomeReasons}
        open={dialog?.type === "DECLINE" || dialog?.type === "REVOKE"}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={refresh}
      />
    </div>
  );
}
