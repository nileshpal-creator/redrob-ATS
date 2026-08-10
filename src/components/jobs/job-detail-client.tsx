"use client";

import Link from "next/link";
import { Building2, CalendarClock, KanbanSquare, MapPin, Pencil, Timer, UserPlus, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { Separator } from "@/components/ui/separator";
import { BackLink } from "@/components/layout/back-link";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { JobStatusActions } from "@/components/jobs/job-status-actions";
import { JobRecruitersEditor } from "@/components/jobs/job-recruiters-editor";
import { JobPostingsCard, type JobPostingRow } from "@/components/job-postings/job-postings-card";
import { ReferCandidateDialog } from "@/components/job-postings/refer-candidate-dialog";

type Person = { id: string; name: string; email: string };
type ReasonOption = { id: string; label: string };
type ListValue = { id: string; label: string };

type JobDetail = {
  id: string;
  title: string;
  status: string;
  priority: string;
  employmentType: string;
  positionsCount: number;
  positionsFilledCount: number;
  targetDate: string | null;
  description: string | null;
  mustHaveCriteria: string[];
  goodToHaveCriteria: string[];
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  department: { label: string };
  location: { label: string };
  primaryRecruiter: Person;
  createdBy: Person;
  parentJob: { id: string; title: string } | null;
  childJobs: { id: string; title: string; status: string }[];
  recruiters: { userId: string; isPrimary: boolean; user: Person }[];
  statusChanges: {
    id: string;
    fromStatus: string;
    toStatus: string;
    note: string | null;
    createdAt: string;
    actor: Person;
    reason: { label: string } | null;
  }[];
};

// Status-color legend (docs/design-system.md) — kept in sync with the same
// map in jobs-client.tsx by hand (client components, no shared server import).
const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "attention" | "destructive"
> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  OPEN: "success",
  ON_HOLD: "attention",
  CLOSED: "secondary",
  CANCELLED: "destructive",
};

// Priority-color legend (docs/design-system.md) — a separate scale from
// status: urgency, not lifecycle state.
const PRIORITY_BADGE_VARIANT: Record<string, "secondary" | "info" | "warning" | "attention"> = {
  LOW: "secondary",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "attention",
};

function agingLabel(createdAt: string) {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  return days <= 0 ? "Created today" : `${days} day${days === 1 ? "" : "s"} old`;
}

export function JobDetailClient({
  job,
  availableTransitions,
  canEdit,
  canManageRecruiters,
  reasonsByListKey,
  sources,
  postings,
  canManagePostings,
  canRefer,
  canCreateApplication,
}: {
  job: JobDetail;
  availableTransitions: { action: string; to: string; reasonRequired: boolean; reasonListKey?: string }[];
  canEdit: boolean;
  canManageRecruiters: boolean;
  reasonsByListKey: Record<string, ReasonOption[]>;
  sources: ListValue[];
  postings: JobPostingRow[];
  canManagePostings: boolean;
  canRefer: boolean;
  canCreateApplication: boolean;
}) {
  return (
    <div className="max-w-4xl space-y-6">
      <BackLink href="/jobs" label="Jobs" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
            <Badge variant={STATUS_BADGE_VARIANT[job.status] ?? "default"}>{job.status.replace("_", " ")}</Badge>
            <Badge variant={PRIORITY_BADGE_VARIANT[job.priority] ?? "secondary"}>{job.priority}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Building2 className="size-3.5" /> {job.department.label}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {job.location.label}
            </span>
            <span className="flex items-center gap-1.5">
              <Timer className="size-3.5" /> {job.employmentType.replace("_", " ")}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" /> {job.primaryRecruiter.name}
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5" /> {agingLabel(job.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {canRefer ? <ReferCandidateDialog jobId={job.id} /> : null}
          {canCreateApplication ? (
            <Button variant="outline" asChild>
              <Link href={`/applications/new?jobId=${job.id}`}>
                <UserPlus /> New application
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link href={`/jobs/${job.id}/pipeline`}>
              <KanbanSquare /> Pipeline
            </Link>
          </Button>
          {canEdit ? (
            <Button variant="outline" asChild>
              <Link href={`/jobs/${job.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {availableTransitions.length > 0 ? (
        <JobStatusActions
          jobId={job.id}
          version={job.version}
          transitions={availableTransitions}
          reasonsByListKey={reasonsByListKey}
        />
      ) : null}

      <Card>
        <CardContent className="flex items-center gap-4">
          <IconBadge module="jobs" icon={Users} size="lg" />
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {job.positionsFilledCount} / {job.positionsCount}
            </p>
            <p className="text-sm text-muted-foreground">positions filled — updates automatically once hiring begins</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recruiters</CardTitle>
            {canManageRecruiters ? (
              <JobRecruitersEditor
                jobId={job.id}
                version={job.version}
                currentAssignments={job.recruiters.map((r) => ({ userId: r.userId, isPrimary: r.isPrimary }))}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {job.recruiters.map((recruiter) => (
            <Badge key={recruiter.userId} variant={recruiter.isPrimary ? "default" : "secondary"}>
              {recruiter.user.name}
              {recruiter.isPrimary ? " (primary)" : ""}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job board postings</CardTitle>
        </CardHeader>
        <CardContent>
          <JobPostingsCard
            jobId={job.id}
            jobStatus={job.status}
            postings={postings}
            sources={sources}
            canManage={canManagePostings}
          />
        </CardContent>
      </Card>

      {job.description ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Description</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{job.description}</CardContent>
        </Card>
      ) : null}

      {job.mustHaveCriteria.length > 0 || job.goodToHaveCriteria.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {job.mustHaveCriteria.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Must-have</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm">
                  {job.mustHaveCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {job.goodToHaveCriteria.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Good-to-have</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm">
                  {job.goodToHaveCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {Object.keys(job.customFields ?? {}).length > 0 ? (
        <CustomFieldsFormSection entityType="JOB" value={job.customFields} onChange={() => {}} disabled />
      ) : null}

      {job.parentJob || job.childJobs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Related requisitions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {job.parentJob ? (
              <p>
                Parent:{" "}
                <Link href={`/jobs/${job.parentJob.id}`} className="hover:underline">
                  {job.parentJob.title}
                </Link>
              </p>
            ) : null}
            {job.childJobs.map((child) => (
              <p key={child.id}>
                Split role:{" "}
                <Link href={`/jobs/${child.id}`} className="hover:underline">
                  {child.title}
                </Link>{" "}
                <Badge variant="secondary">{child.status.replace("_", " ")}</Badge>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {job.statusChanges.map((change, index) => (
            <div key={change.id}>
              {index > 0 ? <Separator className="mb-3" /> : null}
              <p className="text-sm">
                <span className="font-medium">{change.fromStatus.replace("_", " ")}</span> →{" "}
                <span className="font-medium">{change.toStatus.replace("_", " ")}</span>
                {change.reason ? ` — ${change.reason.label}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {change.actor.name} &middot; {new Date(change.createdAt).toLocaleString()}
              </p>
              {change.note ? <p className="mt-1 text-sm text-muted-foreground">{change.note}</p> : null}
            </div>
          ))}
          {job.statusChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No status changes yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
