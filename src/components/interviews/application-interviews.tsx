"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2, MapPin, Plus, Star, Users } from "lucide-react";

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
import { PanelistPicker } from "@/components/interviews/panelist-picker";

type Person = { id: string; name: string; email: string };
type ReasonOption = { id: string; label: string };

type InterviewMode = "ONSITE" | "VIRTUAL" | "PHONE";
type InterviewStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
type Recommendation = "STRONG_YES" | "YES" | "NO" | "STRONG_NO";

type InterviewFeedbackItem = {
  id: string;
  recommendation: Recommendation;
  rating: number | null;
  comments: string | null;
  version: number;
  submittedAt: string;
  interviewer: Person;
};

export type Interview = {
  id: string;
  roundName: string;
  mode: InterviewMode;
  location: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: InterviewStatus;
  cancellationReason: { label: string } | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  version: number;
  scheduledBy: Person;
  panelists: { user: Person }[];
  feedback: InterviewFeedbackItem[];
  /** Computed server-side from scheduledById — reschedule/cancel/complete authority. */
  canManage: boolean;
};

const MODE_LABEL: Record<InterviewMode, string> = { ONSITE: "Onsite", VIRTUAL: "Virtual", PHONE: "Phone" };
// Status-color legend (docs/design-system.md): info=blue (upcoming),
// success=green (completed), attention=orange (no-show — worth a follow-up,
// distinct from a plain cancellation), destructive=red (cancelled).
const STATUS_BADGE_VARIANT: Record<InterviewStatus, "info" | "success" | "destructive" | "attention"> = {
  SCHEDULED: "info",
  COMPLETED: "success",
  CANCELLED: "destructive",
  NO_SHOW: "attention",
};
const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  STRONG_YES: "Strong yes",
  YES: "Yes",
  NO: "No",
  STRONG_NO: "Strong no",
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

function toDatetimeLocalValue(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type ScheduleFormValues = {
  roundName: string;
  mode: InterviewMode;
  location: string;
  scheduledAt: string;
  durationMinutes: number;
  panelistUserIds: string[];
  notes: string;
  customFields: Record<string, unknown>;
};

const EMPTY_SCHEDULE_FORM: ScheduleFormValues = {
  roundName: "",
  mode: "VIRTUAL",
  location: "",
  scheduledAt: "",
  durationMinutes: 60,
  panelistUserIds: [],
  notes: "",
  customFields: {},
};

function ScheduleDialog({
  applicationId,
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  applicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { interview: Interview } | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<ScheduleFormValues>(EMPTY_SCHEDULE_FORM);
  const [submitting, setSubmitting] = useState(false);

  const editingInterview = initial?.interview ?? null;
  const editingId = editingInterview?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setValues(
      editingInterview
        ? {
            roundName: editingInterview.roundName,
            mode: editingInterview.mode,
            location: editingInterview.location ?? "",
            scheduledAt: toDatetimeLocalValue(editingInterview.scheduledAt),
            durationMinutes: editingInterview.durationMinutes,
            panelistUserIds: editingInterview.panelists.map((panelist) => panelist.user.id),
            notes: editingInterview.notes ?? "",
            customFields: editingInterview.customFields ?? {},
          }
        : EMPTY_SCHEDULE_FORM,
    );
    // Reset only when the dialog opens or which interview it targets changes —
    // not on every parent re-render (editingInterview's object identity is
    // unstable across renders, so we key off the id instead).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  function update<K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!values.roundName.trim()) {
      toast.error("Round name is required.");
      return;
    }
    if (!values.scheduledAt) {
      toast.error("Scheduled date & time is required.");
      return;
    }
    if (values.panelistUserIds.length === 0) {
      toast.error("Assign at least one interviewer.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        roundName: values.roundName,
        mode: values.mode,
        location: values.location || undefined,
        scheduledAt: new Date(values.scheduledAt).toISOString(),
        durationMinutes: values.durationMinutes,
        panelistUserIds: values.panelistUserIds,
        notes: values.notes || undefined,
        customFields: values.customFields,
      };

      if (initial) {
        await requestJson(`/api/interviews/${initial.interview.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, version: initial.interview.version }),
        });
        toast.success("Interview updated.");
      } else {
        await requestJson("/api/interviews", {
          method: "POST",
          body: JSON.stringify({ ...payload, applicationId }),
        });
        toast.success("Interview scheduled.");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save interview");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Reschedule interview" : "Schedule interview"}</DialogTitle>
          <DialogDescription>
            {initial ? "Update the details for this interview round." : "Set up a new interview round for this application."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Round name</Label>
            <Input value={values.roundName} onChange={(event) => update("roundName", event.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={values.mode} onValueChange={(value) => update("mode", value as InterviewMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABEL) as InterviewMode[]).map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {MODE_LABEL[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                min={5}
                max={480}
                value={values.durationMinutes}
                onChange={(event) => update("durationMinutes", Number(event.target.value))}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Date & time</Label>
              <Input
                type="datetime-local"
                value={values.scheduledAt}
                onChange={(event) => update("scheduledAt", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Location / link (optional)</Label>
              <Input value={values.location} onChange={(event) => update("location", event.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Interview panel</Label>
            <PanelistPicker value={values.panelistUserIds} onChange={(next) => update("panelistUserIds", next)} />
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea rows={3} value={values.notes} onChange={(event) => update("notes", event.target.value)} />
          </div>

          <CustomFieldsFormSection
            entityType="INTERVIEW"
            value={values.customFields}
            onChange={(next) => update("customFields", next)}
          />
        </div>
        <DialogFooter>
          <Button disabled={submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {initial ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  interview,
  cancellationReasons,
  open,
  onOpenChange,
  onSaved,
}: {
  interview: Interview | null;
  cancellationReasons: ReasonOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!interview || !reasonId) return;
    setSubmitting(true);
    try {
      await requestJson(`/api/interviews/${interview.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ version: interview.version, reasonId, note: note || undefined }),
      });
      toast.success("Interview cancelled.");
      setReasonId("");
      setNote("");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel interview");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel interview</DialogTitle>
          <DialogDescription>A reason is required. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {cancellationReasons.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea placeholder="Optional note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={!reasonId || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Confirm cancellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackDialog({
  interview,
  currentUserId,
  open,
  onOpenChange,
  onSaved,
}: {
  interview: Interview | null;
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const existing = interview?.feedback.find((entry) => entry.interviewer.id === currentUserId) ?? null;
  const [recommendation, setRecommendation] = useState<Recommendation | "">("");
  const [rating, setRating] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecommendation(existing?.recommendation ?? "");
    setRating(existing?.rating ? String(existing.rating) : "");
    setComments(existing?.comments ?? "");
    // Reset when the dialog opens for a given interview — not on every
    // parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interview?.id]);

  async function handleSubmit() {
    if (!interview || !recommendation) {
      toast.error("Select a recommendation.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        recommendation,
        rating: rating ? Number(rating) : undefined,
        comments: comments || undefined,
      };
      if (existing) {
        await requestJson(`/api/interviews/${interview.id}/feedback`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, version: existing.version }),
        });
      } else {
        await requestJson(`/api/interviews/${interview.id}/feedback`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onOpenChange(false);
      onSaved();
      toast.success("Feedback saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit your feedback" : "Submit feedback"}</DialogTitle>
          <DialogDescription>
            {interview?.roundName} &middot; {interview ? new Date(interview.scheduledAt).toLocaleString() : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Recommendation</Label>
            <Select value={recommendation} onValueChange={(value) => setRecommendation(value as Recommendation)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a recommendation" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RECOMMENDATION_LABEL) as Recommendation[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {RECOMMENDATION_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Rating (1-5, optional)</Label>
            <Input type="number" min={1} max={5} value={rating} onChange={(event) => setRating(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Comments (optional)</Label>
            <Textarea rows={4} value={comments} onChange={(event) => setComments(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!recommendation || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {existing ? "Save changes" : "Submit feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ActiveDialog =
  | { type: "SCHEDULE" }
  | { type: "RESCHEDULE"; interview: Interview }
  | { type: "CANCEL"; interview: Interview }
  | { type: "FEEDBACK"; interview: Interview }
  | null;

/**
 * Interview scheduling/list/feedback section for the Application detail
 * page (§11.5). `canSchedule` and each interview's `canManage` are
 * computed server-side (same convention as Application's `canEdit`) —
 * `canManage` mirrors assertManageAccess (scheduledById only), while
 * feedback eligibility is derived client-side from panel membership,
 * since any panelist may submit feedback regardless of scheduling
 * authority.
 */
export function ApplicationInterviews({
  applicationId,
  interviews,
  canSchedule,
  currentUserId,
  cancellationReasons,
}: {
  applicationId: string;
  interviews: Interview[];
  canSchedule: boolean;
  currentUserId: string;
  cancellationReasons: ReasonOption[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [markingNoShowId, setMarkingNoShowId] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  async function handleComplete(interview: Interview) {
    setCompletingId(interview.id);
    try {
      await requestJson(`/api/interviews/${interview.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ version: interview.version }),
      });
      toast.success("Interview marked complete.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete interview");
    } finally {
      setCompletingId(null);
    }
  }

  async function handleMarkNoShow(interview: Interview) {
    setMarkingNoShowId(interview.id);
    try {
      await requestJson(`/api/interviews/${interview.id}/no-show`, {
        method: "POST",
        body: JSON.stringify({ version: interview.version }),
      });
      toast.success("Interview marked as no-show.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to mark interview as no-show");
    } finally {
      setMarkingNoShowId(null);
    }
  }

  return (
    <div className="space-y-4">
      {canSchedule ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setDialog({ type: "SCHEDULE" })}>
            <Plus /> Schedule interview
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {interviews.map((interview, index) => {
          const isPanelist = interview.panelists.some((panelist) => panelist.user.id === currentUserId);
          const myFeedback = interview.feedback.find((entry) => entry.interviewer.id === currentUserId) ?? null;

          return (
            <div key={interview.id}>
              {index > 0 ? <Separator className="mb-3" /> : null}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{interview.roundName}</p>
                  <Badge variant={STATUS_BADGE_VARIANT[interview.status]}>{interview.status}</Badge>
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="size-3.5" />
                    {new Date(interview.scheduledAt).toLocaleString()} &middot; {interview.durationMinutes} min
                    &middot; {MODE_LABEL[interview.mode]}
                  </span>
                  {interview.location ? (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {interview.location}
                    </span>
                  ) : null}
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {interview.panelists.map((panelist) => panelist.user.name).join(", ")}
                  </span>
                </p>
                {interview.status === "CANCELLED" && interview.cancellationReason ? (
                  <p className="text-xs text-muted-foreground">Reason: {interview.cancellationReason.label}</p>
                ) : null}
                {interview.notes ? <p className="text-sm text-muted-foreground">{interview.notes}</p> : null}

                {interview.feedback.length > 0 ? (
                  <div className="space-y-1 rounded-md border p-2.5">
                    {interview.feedback.map((entry) => (
                      <p key={entry.id} className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{entry.interviewer.name}</span>
                        <Badge variant="outline">{RECOMMENDATION_LABEL[entry.recommendation]}</Badge>
                        {entry.rating ? (
                          <span className="flex items-center gap-0.5 text-muted-foreground">
                            <Star className="size-3" />
                            {entry.rating}/5
                          </span>
                        ) : null}
                        {entry.comments ? <span className="text-muted-foreground">— {entry.comments}</span> : null}
                      </p>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {interview.status === "SCHEDULED" && interview.canManage ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ type: "RESCHEDULE", interview })}>
                        Reschedule
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ type: "CANCEL", interview })}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={completingId === interview.id}
                        onClick={() => handleComplete(interview)}
                      >
                        {completingId === interview.id ? <Loader2 className="animate-spin" /> : null}
                        Mark complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={markingNoShowId === interview.id}
                        onClick={() => handleMarkNoShow(interview)}
                      >
                        {markingNoShowId === interview.id ? <Loader2 className="animate-spin" /> : null}
                        Mark no-show
                      </Button>
                    </>
                  ) : null}
                  {interview.status !== "CANCELLED" && interview.status !== "NO_SHOW" && isPanelist ? (
                    <Button size="sm" variant="outline" onClick={() => setDialog({ type: "FEEDBACK", interview })}>
                      {myFeedback ? "Edit feedback" : "Submit feedback"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {interviews.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No interviews yet"
            description="Schedule a round once you're ready to talk with this candidate."
            size="sm"
            action={canSchedule ? { label: "Schedule interview", onClick: () => setDialog({ type: "SCHEDULE" }) } : undefined}
          />
        ) : null}
      </div>

      <ScheduleDialog
        applicationId={applicationId}
        open={dialog?.type === "SCHEDULE" || dialog?.type === "RESCHEDULE"}
        onOpenChange={(open) => !open && setDialog(null)}
        initial={dialog?.type === "RESCHEDULE" ? { interview: dialog.interview } : null}
        onSaved={refresh}
      />
      <CancelDialog
        interview={dialog?.type === "CANCEL" ? dialog.interview : null}
        cancellationReasons={cancellationReasons}
        open={dialog?.type === "CANCEL"}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={refresh}
      />
      <FeedbackDialog
        interview={dialog?.type === "FEEDBACK" ? dialog.interview : null}
        currentUserId={currentUserId}
        open={dialog?.type === "FEEDBACK"}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={refresh}
      />
    </div>
  );
}
