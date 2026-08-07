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
    };

function ApplicationTimelineEntry({ item }: { item: Exclude<TimelineItem, { type: "note" }> }) {
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

/**
 * Candidate timeline (§11.2 FR9) — originally sourced only from notes;
 * Module 4 is the first module to add its own `type`s to the same feed
 * (application_created/application_stage_changed/application_rejected/
 * application_withdrawn), exactly as the API contract
 * (`{ items: [{ type, ... }] }`) was built to extend. Future modules
 * (Interview, Offer, Communication Hub) follow the same pattern.
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
            ) : (
              <ApplicationTimelineEntry item={item} />
            )}
          </div>
        ))}
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
      </div>
    </div>
  );
}
