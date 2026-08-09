"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { History, Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

async function requestJson(url: string, init: RequestInit = {}) {
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

type VersionStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "ARCHIVED";

export type TemplateVersionRow = {
  id: string;
  versionNumber: number;
  language: string;
  subject: string;
  body: string;
  status: VersionStatus;
  comments: string | null;
  createdBy: { name: string };
  createdAt: string;
  submittedBy: { name: string } | null;
  submittedAt: string | null;
  decidedBy: { name: string } | null;
  decidedAt: string | null;
};

const STATUS_VARIANT: Record<VersionStatus, "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  PENDING_APPROVAL: "outline",
  ACTIVE: "secondary",
  REJECTED: "destructive",
  ARCHIVED: "outline",
};

function NewDraftForm({ templateId, onCreated }: { templateId: string; onCreated: (version: TemplateVersionRow) => void }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("en");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const version = await requestJson(`/api/communication-templates/${templateId}/versions`, {
        method: "POST",
        body: JSON.stringify({ language, subject, body }),
      });
      onCreated(version);
      toast.success("Draft version created.");
      setOpen(false);
      setSubject("");
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create draft");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> New draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New draft version</DialogTitle>
          <DialogDescription>
            Submit it for approval once ready — approving an &quot;en&quot; draft replaces the template&apos;s live
            content immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Language</label>
            <Input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Subject</label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Body</label>
            <Textarea
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={"Hi {{candidate.name}}, {{#if job.title}}about {{job.title}}{{/if}}..."}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !language.trim() || !subject.trim() || !body.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideRow({
  version,
  templateId,
  canApprove,
  onChanged,
}: {
  version: TemplateVersionRow;
  templateId: string;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState("");

  async function handleSubmitForApproval() {
    setBusy(true);
    try {
      await requestJson(`/api/communication-templates/${templateId}/versions/${version.id}/submit`, {
        method: "POST",
      });
      onChanged();
      toast.success("Submitted for approval.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecide(decision: "APPROVE" | "REJECT") {
    setBusy(true);
    try {
      await requestJson(`/api/communication-templates/${templateId}/versions/${version.id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, comments: comments || undefined }),
      });
      onChanged();
      toast.success(decision === "APPROVE" ? "Approved and made active." : "Rejected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to decide");
    } finally {
      setBusy(false);
    }
  }

  async function handleRollback() {
    setBusy(true);
    try {
      await requestJson(`/api/communication-templates/${templateId}/versions/${version.id}/rollback`, {
        method: "POST",
      });
      onChanged();
      toast.success("Restored as the active version.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore");
    } finally {
      setBusy(false);
    }
  }

  if (version.status === "DRAFT") {
    return (
      <Button size="sm" variant="outline" onClick={handleSubmitForApproval} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        Submit for approval
      </Button>
    );
  }

  if (version.status === "PENDING_APPROVAL" && canApprove) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-40"
          placeholder="Comments (optional)"
          value={comments}
          onChange={(event) => setComments(event.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => handleDecide("REJECT")} disabled={busy}>
          Reject
        </Button>
        <Button size="sm" onClick={() => handleDecide("APPROVE")} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Approve
        </Button>
      </div>
    );
  }

  if (version.status === "ARCHIVED" && canApprove) {
    return (
      <Button size="sm" variant="outline" onClick={handleRollback} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        Restore
      </Button>
    );
  }

  return null;
}

/**
 * §10.4's version-history + approval-workflow layer, additive on top of
 * CommunicationTemplate's own direct-edit path (the Edit dialog next to
 * this button) — see the model comment on CommunicationTemplateVersion in
 * schema.prisma for how the two relate.
 */
export function TemplateVersionsDialog({
  templateId,
  templateName,
  canApprove,
}: {
  templateId: string;
  templateName: string;
  canApprove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<TemplateVersionRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    requestJson(`/api/communication-templates/${templateId}/versions`)
      .then((result) => {
        if (!cancelled) setVersions(result);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load versions"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, templateId]);

  // Approving/rolling back archives the previously-ACTIVE sibling for the
  // same language server-side — refetch the whole list so that flip shows
  // up too, rather than tracking it optimistically here.
  function handleChanged() {
    requestJson(`/api/communication-templates/${templateId}/versions`)
      .then(setVersions)
      .catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History /> Versions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Version history — {templateName}</DialogTitle>
          <DialogDescription>
            One history per language. Approving an &quot;en&quot; version updates the template&apos;s live content
            immediately; other languages are picked up automatically for a candidate whose preferred language
            matches.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <NewDraftForm templateId={templateId} onCreated={(version) => setVersions((prev) => [version, ...prev])} />
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet — create a draft to start one.</p>
        ) : (
          <div className="space-y-2">
            {versions.map((version) => (
              <div key={version.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {version.language} &middot; v{version.versionNumber}{" "}
                      <Badge variant={STATUS_VARIANT[version.status]} className="ml-1">
                        {version.status.replace("_", " ")}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">{version.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      Created by {version.createdBy.name} &middot; {new Date(version.createdAt).toLocaleString()}
                    </p>
                    {version.decidedBy ? (
                      <p className="text-xs text-muted-foreground">
                        Decided by {version.decidedBy.name}
                        {version.comments ? ` — "${version.comments}"` : ""}
                      </p>
                    ) : null}
                  </div>
                  <DecideRow version={version} templateId={templateId} canApprove={canApprove} onChanged={handleChanged} />
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
