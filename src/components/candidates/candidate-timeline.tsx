"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

type Person = { id: string; name: string; email: string };

type TimelineItem =
  | { type: "note"; id: string; body: string; author: Person; createdAt: string }
  | { type: "application_created"; id: string; jobId: string; jobTitle: string; stage: string; createdAt: string }
  | {
      type: "application_stage_changed" | "application_rejected" | "application_withdrawn";
      id: string;
      applicationId: string;
      jobId: string;
      jobTitle: string;
      actor: Person;
      note: string | null;
      fromStage?: string | null;
      toStage?: string | null;
      reason?: string | null;
      createdAt: string;
    }
  | {
      type: "interview_scheduled";
      id: string;
      jobId: string;
      jobTitle: string;
      roundName: string;
      scheduledAt: string;
      createdAt: string;
    }
  | {
      type: "interview_completed" | "interview_cancelled";
      id: string;
      jobId: string;
      jobTitle: string;
      roundName: string;
      reason: string | null;
      createdAt: string;
    }
  | {
      type: "interview_feedback_submitted";
      id: string;
      jobId: string;
      jobTitle: string;
      roundName: string;
      interviewer: Person;
      recommendation: "STRONG_YES" | "YES" | "NO" | "STRONG_NO";
      createdAt: string;
    }
  | { type: "offer_created"; id: string; jobId: string; jobTitle: string; compensation: string; createdAt: string }
  | {
      type: "offer_approved" | "offer_approval_rejected";
      id: string;
      jobId: string;
      jobTitle: string;
      approver: Person | null;
      comments: string | null;
      createdAt: string;
    }
  | {
      type: "offer_extended" | "offer_accepted" | "offer_declined" | "offer_revoked";
      id: string;
      jobId: string;
      jobTitle: string;
      reason: string | null;
      createdAt: string;
    }
  | {
      type: "handoff_initiated";
      id: string;
      jobId: string;
      jobTitle: string;
      deliveryMethod: "API_PUSH" | "STRUCTURED_EXPORT";
      initiatedBy: Person;
      createdAt: string;
    }
  | {
      type: "handoff_delivered" | "handoff_accepted" | "handoff_exception";
      id: string;
      jobId: string;
      jobTitle: string;
      actor: Person;
      reason: string | null;
      createdAt: string;
    }
  | {
      type: "email_sent" | "email_failed";
      id: string;
      jobId: string;
      jobTitle: string;
      templateName: string;
      subject: string;
      requestedBy: Person;
      createdAt: string;
    };

const RECOMMENDATION_LABEL: Record<string, string> = {
  STRONG_YES: "Strong yes",
  YES: "Yes",
  NO: "No",
  STRONG_NO: "Strong no",
};

type InterviewTimelineItem = Extract<
  TimelineItem,
  {
    type:
      | "interview_scheduled"
      | "interview_completed"
      | "interview_cancelled"
      | "interview_feedback_submitted"
      | "application_stage_changed"
      | "application_rejected"
      | "application_withdrawn";
  }
>;

function InterviewTimelineEntry({ item }: { item: InterviewTimelineItem }) {
  const jobLink = (
    <Link href={`/jobs/${item.jobId}`} className="font-medium hover:underline">
      {item.jobTitle}
    </Link>
  );

  switch (item.type) {
    case "interview_scheduled":
      return (
        <p className="text-sm">
          Interview scheduled — {item.roundName} for {jobLink} on {new Date(item.scheduledAt).toLocaleString()}
        </p>
      );

    case "interview_completed":
    case "interview_cancelled":
      return (
        <p className="text-sm">
          {item.type === "interview_completed" ? "Interview completed" : "Interview cancelled"} — {item.roundName}{" "}
          for {jobLink}
          {item.reason ? ` — ${item.reason}` : ""}
        </p>
      );

    case "interview_feedback_submitted":
      return (
        <p className="text-sm">
          Feedback submitted for {item.roundName} ({jobLink}) by {item.interviewer.name}:{" "}
          <Badge variant="secondary">{RECOMMENDATION_LABEL[item.recommendation]}</Badge>
        </p>
      );

    default:
      return <ApplicationTimelineEntry item={item} />;
  }
}

type ApplicationTimelineItem = Extract<
  TimelineItem,
  { type: "application_created" | "application_stage_changed" | "application_rejected" | "application_withdrawn" }
>;

function ApplicationTimelineEntry({ item }: { item: ApplicationTimelineItem }) {
  const jobLink = (
    <Link href={`/jobs/${item.jobId}`} className="font-medium hover:underline">
      {item.jobTitle}
    </Link>
  );

  if (item.type === "application_created") {
    return (
      <p className="text-sm">
        Applied to {jobLink} <Badge variant="secondary">{item.stage}</Badge>
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm">
        <Link href={`/applications/${item.applicationId}`} className="hover:underline">
          {item.type === "application_stage_changed"
            ? "Stage changed"
            : item.type === "application_rejected"
              ? "Rejected"
              : "Withdrawn"}
        </Link>{" "}
        for {jobLink}
        {item.type === "application_stage_changed" ? (
          <>
            {" "}
            ({item.fromStage ?? "—"} → {item.toStage ?? "—"})
          </>
        ) : item.reason ? (
          ` — ${item.reason}`
        ) : (
          ""
        )}
      </p>
      <p className="text-xs text-muted-foreground">{item.actor.name}</p>
      {item.note ? <p className="mt-1 text-sm text-muted-foreground">{item.note}</p> : null}
    </div>
  );
}

type OfferTimelineItem = Extract<
  TimelineItem,
  {
    type:
      | "offer_created"
      | "offer_approved"
      | "offer_approval_rejected"
      | "offer_extended"
      | "offer_accepted"
      | "offer_declined"
      | "offer_revoked";
  }
>;

/** Type predicate (not a plain boolean check) so the render dispatcher below narrows correctly. */
function isOfferTimelineItem(item: TimelineItem): item is OfferTimelineItem {
  return (
    item.type === "offer_created" ||
    item.type === "offer_approved" ||
    item.type === "offer_approval_rejected" ||
    item.type === "offer_extended" ||
    item.type === "offer_accepted" ||
    item.type === "offer_declined" ||
    item.type === "offer_revoked"
  );
}

function OfferTimelineEntry({ item }: { item: OfferTimelineItem }) {
  const jobLink = (
    <Link href={`/jobs/${item.jobId}`} className="font-medium hover:underline">
      {item.jobTitle}
    </Link>
  );

  switch (item.type) {
    case "offer_created":
      return (
        <p className="text-sm">
          Offer created for {jobLink} — {item.compensation}
        </p>
      );

    case "offer_approved":
    case "offer_approval_rejected":
      return (
        <p className="text-sm">
          Offer {item.type === "offer_approved" ? "approved" : "sent back for revision"} for {jobLink}
          {item.approver ? ` by ${item.approver.name}` : ""}
          {item.comments ? ` — ${item.comments}` : ""}
        </p>
      );

    case "offer_extended":
      return <p className="text-sm">Offer extended to candidate for {jobLink}</p>;

    case "offer_accepted":
      return <p className="text-sm">Offer accepted for {jobLink}</p>;

    case "offer_declined":
    case "offer_revoked":
      return (
        <p className="text-sm">
          Offer {item.type === "offer_declined" ? "declined" : "revoked"} for {jobLink}
          {item.reason ? ` — ${item.reason}` : ""}
        </p>
      );
  }
}

type HandoffTimelineItem = Extract<
  TimelineItem,
  { type: "handoff_initiated" | "handoff_delivered" | "handoff_accepted" | "handoff_exception" }
>;

/** Type predicate (not a plain boolean check) so the render dispatcher below narrows correctly. */
function isHandoffTimelineItem(item: TimelineItem): item is HandoffTimelineItem {
  return (
    item.type === "handoff_initiated" ||
    item.type === "handoff_delivered" ||
    item.type === "handoff_accepted" ||
    item.type === "handoff_exception"
  );
}

function HandoffTimelineEntry({ item }: { item: HandoffTimelineItem }) {
  const jobLink = (
    <Link href={`/jobs/${item.jobId}`} className="font-medium hover:underline">
      {item.jobTitle}
    </Link>
  );

  switch (item.type) {
    case "handoff_initiated":
      return (
        <p className="text-sm">
          Onboarding handoff initiated for {jobLink} by {item.initiatedBy.name} ({item.deliveryMethod.replace("_", " ").toLowerCase()})
        </p>
      );

    case "handoff_delivered":
      return (
        <p className="text-sm">
          Handoff package delivered for {jobLink}
        </p>
      );

    case "handoff_accepted":
      return (
        <p className="text-sm">
          Handoff acknowledged for {jobLink} by {item.actor.name}
        </p>
      );

    case "handoff_exception":
      return (
        <p className="text-sm">
          Handoff exception for {jobLink} — {item.actor.name}
          {item.reason ? `: ${item.reason}` : ""}
        </p>
      );
  }
}

type EmailTimelineItem = Extract<TimelineItem, { type: "email_sent" | "email_failed" }>;

/** Type predicate (not a plain boolean check) so the render dispatcher below narrows correctly. */
function isEmailTimelineItem(item: TimelineItem): item is EmailTimelineItem {
  return item.type === "email_sent" || item.type === "email_failed";
}

function EmailTimelineEntry({ item }: { item: EmailTimelineItem }) {
  const jobLink = (
    <Link href={`/jobs/${item.jobId}`} className="font-medium hover:underline">
      {item.jobTitle}
    </Link>
  );

  return (
    <div>
      <p className="text-sm">
        {item.type === "email_sent" ? "Email sent" : "Email failed to deliver"} for {jobLink} — &quot;{item.subject}
        &quot;
      </p>
      <p className="text-xs text-muted-foreground">
        {item.templateName} &middot; sent by {item.requestedBy.name}
      </p>
    </div>
  );
}

/**
 * Candidate timeline (§11.2 FR9) — originally sourced only from notes;
 * Module 4 is the first module to add its own `type`s to the same feed
 * (application_created/application_stage_changed/application_rejected/
 * application_withdrawn), exactly as the API contract
 * (`{ items: [{ type, ... }] }`) was built to extend. Modules 5, 6, 7, and 8
 * (Interview, Offer, Handoff, Communication Hub) follow the same pattern; a
 * future module adds more `type`s the same way.
 */
export function CandidateTimeline({
  candidateId,
  items,
  canAddNote,
}: {
  candidateId: string;
  items: TimelineItem[];
  canAddNote: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAddNote() {
    if (!body.trim()) {
      toast.error("Note cannot be empty.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        throw new Error(responseBody.error ?? "Failed to add note");
      }
      setBody("");
      toast.success("Note added.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add note");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {canAddNote ? (
        <div className="space-y-2">
          <Textarea
            placeholder="Add a note visible to your team…"
            rows={2}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAddNote} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Send />}
              Add note
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id}>
            {index > 0 ? <Separator className="mb-3" /> : null}
            {item.type === "note" ? (
              <>
                <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                <p className="text-xs text-muted-foreground">
                  {item.author.name} &middot; {new Date(item.createdAt).toLocaleString()}
                </p>
              </>
            ) : item.type === "application_created" ? (
              <ApplicationTimelineEntry item={item} />
            ) : isOfferTimelineItem(item) ? (
              <OfferTimelineEntry item={item} />
            ) : isHandoffTimelineItem(item) ? (
              <HandoffTimelineEntry item={item} />
            ) : isEmailTimelineItem(item) ? (
              <EmailTimelineEntry item={item} />
            ) : (
              <InterviewTimelineEntry item={item} />
            )}
          </div>
        ))}
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
      </div>
    </div>
  );
}
