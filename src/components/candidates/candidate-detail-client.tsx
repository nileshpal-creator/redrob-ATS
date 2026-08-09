"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, KanbanSquare, Loader2, Pencil, ShieldOff, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { CandidateDocuments } from "@/components/candidates/candidate-documents";
import { CandidateTimeline } from "@/components/candidates/candidate-timeline";
import { CandidateMergeDialog } from "@/components/candidates/candidate-merge-dialog";
import { cn } from "@/lib/utils";

type ListValue = { id: string; label: string };
type Person = { id: string; name: string; email: string };

type ExperienceEntry = { company: string; title: string; startDate: string; endDate: string | null; description?: string };
type EducationEntry = { institution: string; degree: string; fieldOfStudy?: string; startYear?: number; endYear?: number };

type CandidateDetail = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  location: string | null;
  currentCompensation: string | null;
  expectedCompensation: string | null;
  noticePeriodDays: number | null;
  earliestAvailability: string | null;
  totalExperienceYears: string | null;
  skills: string[];
  tags: string[];
  experienceHistory: ExperienceEntry[] | null;
  educationHistory: EducationEntry[] | null;
  consentGivenAt: string;
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  anonymizedAt: string | null;
  source: { label: string } | null;
  createdBy: Person;
  documents: {
    id: string;
    fileName: string;
    fileSize: number;
    uploadedAt: string;
    documentType: { label: string };
    uploadedBy: Person;
  }[];
};

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
    }
  | {
      type: "task_created";
      id: string;
      jobId: string;
      jobTitle: string;
      title: string;
      assignedTo: Person;
      dueAt: string | null;
      createdAt: string;
    }
  | {
      type: "task_completed" | "task_approved" | "task_rejected";
      id: string;
      jobId: string;
      jobTitle: string;
      title: string;
      assignedTo: Person;
      createdAt: string;
    };

type MyErasureRequest = {
  id: string;
  method: "ANONYMIZE" | "HARD_DELETE";
  status: "PENDING" | "COMPLETED" | "REJECTED";
  reason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNotes: string | null;
};

export function CandidateDetailClient({
  candidate,
  documentTypes,
  timelineItems,
  canEdit,
  canDelete,
  canCreateApplication,
  myErasureRequests: initialMyErasureRequests,
}: {
  candidate: CandidateDetail;
  documentTypes: ListValue[];
  timelineItems: TimelineItem[];
  canEdit: boolean;
  canDelete: boolean;
  canCreateApplication: boolean;
  myErasureRequests: MyErasureRequest[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const possibleDuplicateOf = searchParams.get("possibleDuplicateOf");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [erasureOpen, setErasureOpen] = useState(false);
  const [erasureMethod, setErasureMethod] = useState<"ANONYMIZE" | "HARD_DELETE">("ANONYMIZE");
  const [erasureReason, setErasureReason] = useState("");
  const [requestingErasure, setRequestingErasure] = useState(false);
  const [myErasureRequests, setMyErasureRequests] = useState(initialMyErasureRequests);
  const latestErasureRequest = myErasureRequests[0] as MyErasureRequest | undefined;

  async function handleRequestErasure() {
    setRequestingErasure(true);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/erasure-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: erasureMethod, reason: erasureReason || undefined }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to submit erasure request");
      }
      setMyErasureRequests((prev) => [body, ...prev]);
      toast.success("Erasure request submitted for review.");
      setErasureOpen(false);
      setErasureReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit erasure request");
    } finally {
      setRequestingErasure(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Failed to delete candidate");
      }
      toast.success("Candidate deleted.");
      router.push("/candidates");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete candidate");
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{candidate.name}</h1>
          <p className="text-muted-foreground">
            {candidate.phone}
            {candidate.email ? ` · ${candidate.email}` : ""}
            {candidate.location ? ` · ${candidate.location}` : ""}
            {candidate.source ? ` · ${candidate.source.label}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {canCreateApplication ? (
            <Button variant="outline" asChild>
              <Link href={`/applications/new?candidateId=${candidate.id}`}>
                <KanbanSquare /> New application
              </Link>
            </Button>
          ) : null}
          {canEdit && !candidate.anonymizedAt ? (
            <CandidateMergeDialog targetCandidateId={candidate.id} version={candidate.version} defaultSourceCandidateId={possibleDuplicateOf ?? undefined} />
          ) : null}
          {canEdit && !candidate.anonymizedAt ? (
            <Button variant="outline" asChild>
              <Link href={`/candidates/${candidate.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          ) : null}
          {canDelete && !candidate.anonymizedAt && latestErasureRequest?.status !== "PENDING" ? (
            <Button variant="outline" onClick={() => setErasureOpen(true)}>
              <ShieldOff /> Request erasure
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="outline" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="text-destructive" /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      {candidate.anonymizedAt ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <ShieldOff className="mt-0.5 size-4 shrink-0" />
          <p>
            This candidate&apos;s personal data was erased on {new Date(candidate.anonymizedAt).toLocaleDateString()}{" "}
            (§13, GDPR data-erasure). Pipeline history is preserved; profile fields cannot be edited further.
          </p>
        </div>
      ) : null}

      {latestErasureRequest && latestErasureRequest.status !== "COMPLETED" ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border p-3 text-sm",
            latestErasureRequest.status === "PENDING"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-destructive/50 bg-destructive/10 text-destructive",
          )}
        >
          <ShieldOff className="mt-0.5 size-4 shrink-0" />
          <p>
            {latestErasureRequest.status === "PENDING" ? (
              <>
                Your {latestErasureRequest.method === "ANONYMIZE" ? "anonymize" : "hard-delete"} erasure request
                submitted {new Date(latestErasureRequest.requestedAt).toLocaleDateString()} is pending compliance
                review.
              </>
            ) : (
              <>
                Your {latestErasureRequest.method === "ANONYMIZE" ? "anonymize" : "hard-delete"} erasure request was
                rejected{latestErasureRequest.decidedAt ? ` on ${new Date(latestErasureRequest.decidedAt).toLocaleDateString()}` : ""}
                {latestErasureRequest.decisionNotes ? ` — "${latestErasureRequest.decisionNotes}"` : ""}.
              </>
            )}
          </p>
        </div>
      ) : null}

      {possibleDuplicateOf ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            This candidate shares an email with an existing record. Use &quot;Merge duplicate&quot; above if
            they&apos;re the same person.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compensation</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Current: {candidate.currentCompensation ?? "—"}</p>
            <p>Expected: {candidate.expectedCompensation ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Availability</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Notice period: {candidate.noticePeriodDays !== null ? `${candidate.noticePeriodDays} days` : "—"}</p>
            <p>
              Earliest start:{" "}
              {candidate.earliestAvailability ? new Date(candidate.earliestAvailability).toLocaleDateString() : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Experience</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{candidate.totalExperienceYears ? `${candidate.totalExperienceYears} years` : "Not specified"}</p>
          </CardContent>
        </Card>
      </div>

      {candidate.skills.length > 0 || candidate.tags.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {candidate.skills.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-muted-foreground">Skills</p>
              <div className="flex flex-wrap gap-1">
                {candidate.skills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {candidate.tags.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1">
                {candidate.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {candidate.experienceHistory && candidate.experienceHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Professional experience</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidate.experienceHistory.map((entry, index) => (
              <div key={index} className="text-sm">
                <p className="font-medium">
                  {entry.title} &middot; {entry.company}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.startDate} — {entry.endDate ?? "Present"}
                </p>
                {entry.description ? <p className="mt-1">{entry.description}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {candidate.educationHistory && candidate.educationHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Education</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidate.educationHistory.map((entry, index) => (
              <div key={index} className="text-sm">
                <p className="font-medium">
                  {entry.degree}
                  {entry.fieldOfStudy ? `, ${entry.fieldOfStudy}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.institution}
                  {entry.startYear ? ` · ${entry.startYear}–${entry.endYear ?? ""}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {Object.keys(candidate.customFields ?? {}).length > 0 ? (
        <CustomFieldsFormSection entityType="CANDIDATE" value={candidate.customFields} onChange={() => {}} disabled />
      ) : null}

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">
          <Card>
            <CardContent className="pt-6">
              <CandidateDocuments
                candidateId={candidate.id}
                documents={candidate.documents}
                documentTypes={documentTypes}
                canManage={canEdit}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-6">
              <CandidateTimeline candidateId={candidate.id} items={timelineItems} canAddNote={canEdit} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={erasureOpen} onOpenChange={setErasureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request data erasure</DialogTitle>
            <DialogDescription>
              Submits a §13 GDPR erasure request for a compliance admin to review. Anonymize overwrites this
              candidate&apos;s personal fields while keeping their application/interview/offer history intact; hard
              delete removes the record outright (blocked if any application exists).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={erasureMethod} onValueChange={(value) => setErasureMethod(value as typeof erasureMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANONYMIZE">Anonymize (keep pipeline history)</SelectItem>
                  <SelectItem value="HARD_DELETE">Hard delete (no applications only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={erasureReason} onChange={(event) => setErasureReason(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErasureOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRequestErasure} disabled={requestingErasure}>
              {requestingErasure ? <Loader2 className="animate-spin" /> : null}
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this candidate?</DialogTitle>
            <DialogDescription>
              This permanently removes {candidate.name} along with their documents and notes. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
