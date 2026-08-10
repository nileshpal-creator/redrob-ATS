"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Inbox, Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ListValue = { id: string; label: string };
type PostingStatus = "POSTED" | "REMOVED" | "FAILED";

export type JobPostingRow = {
  id: string;
  status: PostingStatus;
  source: { id: string; label: string };
  errorMessage: string | null;
  postedAt: string;
  removedAt: string | null;
};

// Status-color legend (docs/design-system.md): success=green (live),
// neutral=gray (removed), destructive=red (failed to post).
const STATUS_BADGE_VARIANT: Record<PostingStatus, "success" | "secondary" | "destructive"> = {
  POSTED: "success",
  REMOVED: "secondary",
  FAILED: "destructive",
};

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function PostToBoardDialog({ jobId, availableSources }: { jobId: string; availableSources: ListValue[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await requestJson(`/api/jobs/${jobId}/postings`, { method: "POST", body: JSON.stringify({ sourceId }) });
      toast.success("Posted.");
      setOpen(false);
      setSourceId("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to post");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={availableSources.length === 0}>
          <Plus /> Post to a board
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post this job to a board</DialogTitle>
          <DialogDescription>
            Reuses the same board/channel list candidates are attributed to — pick which one to post to.
          </DialogDescription>
        </DialogHeader>
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a board" />
          </SelectTrigger>
          <SelectContent>
            {availableSources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!sourceId || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordInboundApplicationDialog({
  postingId,
  open,
  onOpenChange,
  onRecorded,
}: {
  postingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setPhone("");
    setEmail("");
    setNote("");
  }

  async function handleSubmit() {
    if (!postingId) return;
    setSubmitting(true);
    try {
      await requestJson(`/api/job-postings/${postingId}/inbound`, {
        method: "POST",
        body: JSON.stringify({ name, phone, email: email || undefined, note: note || undefined }),
      });
      toast.success("Application recorded.");
      reset();
      onOpenChange(false);
      onRecorded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an inbound application</DialogTitle>
          <DialogDescription>
            What the board notified you about — the candidate and application are created for you, tagged with
            this board as the source automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="inbound-name">Name</Label>
            <Input id="inbound-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inbound-phone">Phone</Label>
            <Input id="inbound-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inbound-email">Email (optional)</Label>
            <Input id="inbound-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inbound-note">Note (optional)</Label>
            <Textarea id="inbound-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || !phone.trim() || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Record application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * §11.3's posting-management cluster: publish/remove a board listing, see
 * its status, and record an inbound application against it. No provider
 * credentials exist in this environment (MockJobBoardProvider only) — see
 * docs/project-status.md for what a real board integration still needs.
 */
export function JobPostingsCard({
  jobId,
  jobStatus,
  postings,
  sources,
  canManage,
}: {
  jobId: string;
  jobStatus: string;
  postings: JobPostingRow[];
  sources: ListValue[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [actingId, setActingId] = useState<string | null>(null);
  const [inboundFor, setInboundFor] = useState<string | null>(null);

  const postedSourceIds = new Set(postings.filter((posting) => posting.status === "POSTED").map((posting) => posting.source.id));
  const availableSources = sources.filter((source) => !postedSourceIds.has(source.id));

  async function handleRemove(postingId: string) {
    setActingId(postingId);
    try {
      await requestJson(`/api/job-postings/${postingId}/remove`, { method: "POST" });
      toast.success("Posting removed.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove posting");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && jobStatus === "OPEN" ? (
        <div className="flex justify-end">
          <PostToBoardDialog jobId={jobId} availableSources={availableSources} />
        </div>
      ) : null}

      {postings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not posted to any board yet.</p>
      ) : (
        postings.map((posting, index) => (
          <div key={posting.id}>
            {index > 0 ? <Separator className="mb-3" /> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {posting.source.label} <Badge variant={STATUS_BADGE_VARIANT[posting.status]} className="ml-1">{posting.status}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {posting.status === "REMOVED" && posting.removedAt
                    ? `Removed ${new Date(posting.removedAt).toLocaleString()}`
                    : `Posted ${new Date(posting.postedAt).toLocaleString()}`}
                </p>
                {posting.status === "FAILED" && posting.errorMessage ? (
                  <p className="text-xs text-destructive">{posting.errorMessage}</p>
                ) : null}
              </div>
              {canManage && posting.status === "POSTED" ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setInboundFor(posting.id)}>
                    <Inbox /> Record inbound application
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actingId === posting.id}
                    onClick={() => handleRemove(posting.id)}
                  >
                    {actingId === posting.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}

      <RecordInboundApplicationDialog
        postingId={inboundFor}
        open={inboundFor !== null}
        onOpenChange={(open) => !open && setInboundFor(null)}
        onRecorded={() => router.refresh()}
      />
    </div>
  );
}
