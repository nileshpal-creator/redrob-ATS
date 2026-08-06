"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

type Person = { id: string; name: string; email: string };

type TimelineItem = {
  type: "note";
  id: string;
  body: string;
  author: Person;
  createdAt: string;
};

/**
 * Candidate timeline (§11.2 FR9) — currently sourced only from notes; future
 * modules (Application, Interview, Offer, Communication Hub) add their own
 * `type`s to the same feed without this component changing, since the API
 * contract (`{ items: [{ type, ... }] }`) is already built to extend.
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
            <p className="text-sm whitespace-pre-wrap">{item.body}</p>
            <p className="text-xs text-muted-foreground">
              {item.author.name} &middot; {new Date(item.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
      </div>
    </div>
  );
}
