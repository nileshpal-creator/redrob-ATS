"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, KanbanSquare, Loader2, Pencil, Trash2 } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { CandidateDocuments } from "@/components/candidates/candidate-documents";
import { CandidateTimeline } from "@/components/candidates/candidate-timeline";
import { CandidateMergeDialog } from "@/components/candidates/candidate-merge-dialog";

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
    };

export function CandidateDetailClient({
  candidate,
  documentTypes,
  timelineItems,
  canEdit,
  canDelete,
  canCreateApplication,
}: {
  candidate: CandidateDetail;
  documentTypes: ListValue[];
  timelineItems: TimelineItem[];
  canEdit: boolean;
  canDelete: boolean;
  canCreateApplication: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const possibleDuplicateOf = searchParams.get("possibleDuplicateOf");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
          {canEdit ? <CandidateMergeDialog targetCandidateId={candidate.id} version={candidate.version} defaultSourceCandidateId={possibleDuplicateOf ?? undefined} /> : null}
          {canEdit ? (
            <Button variant="outline" asChild>
              <Link href={`/candidates/${candidate.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="outline" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="text-destructive" /> Delete
            </Button>
          ) : null}
        </div>
      </div>

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
