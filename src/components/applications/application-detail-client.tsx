"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { ApplicationTransitionActions } from "@/components/applications/application-transition-actions";
import { ApplicationOwnerEditor } from "@/components/applications/application-owner-editor";
import {
  ApplicationDuplicateCheck,
  type PriorApplication,
} from "@/components/applications/application-duplicate-check";
import { ApplicationInterviews, type Interview } from "@/components/interviews/application-interviews";
import { ApplicationOffers, type Offer } from "@/components/offers/application-offers";

type Person = { id: string; name: string; email: string };
type ReasonOption = { id: string; label: string };

type ApplicationEvent = {
  id: string;
  type: "STAGE_CHANGE" | "REJECTED" | "WITHDRAWN";
  note: string | null;
  createdAt: string;
  actor: Person;
  fromStage: { name: string } | null;
  toStage: { name: string } | null;
  reason: { label: string } | null;
};

type ApplicationDetail = {
  id: string;
  outcome: "ACTIVE" | "REJECTED" | "WITHDRAWN";
  outcomeAt: string | null;
  version: number;
  createdAt: string;
  stageEnteredAt: string;
  customFields: Record<string, unknown>;
  candidateId: string;
  jobId: string;
  candidate: { id: string; name: string; phone: string; email: string | null };
  job: { id: string; title: string };
  stage: { id: string; name: string };
  owner: Person;
  createdBy: Person;
  outcomeReason: { label: string } | null;
  events: ApplicationEvent[];
};

const OUTCOME_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  ACTIVE: "default",
  REJECTED: "destructive",
  WITHDRAWN: "secondary",
};

const EVENT_LABEL: Record<ApplicationEvent["type"], string> = {
  STAGE_CHANGE: "Stage changed",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export function ApplicationDetailClient({
  application,
  canEdit,
  rejectionReasons,
  interviews,
  canScheduleInterview,
  cancellationReasons,
  offers,
  canCreateOffer,
  offerOutcomeReasons,
  currentUserId,
}: {
  application: ApplicationDetail;
  canEdit: boolean;
  rejectionReasons: ReasonOption[];
  interviews: Interview[];
  canScheduleInterview: boolean;
  cancellationReasons: ReasonOption[];
  offers: Offer[];
  canCreateOffer: boolean;
  offerOutcomeReasons: ReasonOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [customFields, setCustomFields] = useState(application.customFields ?? {});
  const [savingFields, setSavingFields] = useState(false);
  const [priorApplications, setPriorApplications] = useState<PriorApplication[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/applications/duplicates?candidateId=${application.candidateId}&jobId=${application.jobId}`)
      .then((response) => response.json())
      .then((data: { priorApplications: PriorApplication[] }) => {
        if (!cancelled) {
          setPriorApplications((data.priorApplications ?? []).filter((prior) => prior.id !== application.id));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [application.candidateId, application.jobId, application.id]);

  async function saveCustomFields() {
    setSavingFields(true);
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: application.version, customFields }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to save custom fields");
      }
      toast.success("Custom fields saved.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save custom fields");
    } finally {
      setSavingFields(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Link href={`/candidates/${application.candidate.id}`} className="hover:underline">
              {application.candidate.name}
            </Link>
            <span className="mx-2 text-muted-foreground">for</span>
            <Link href={`/jobs/${application.job.id}`} className="hover:underline">
              {application.job.title}
            </Link>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            <Badge variant={OUTCOME_BADGE_VARIANT[application.outcome]}>{application.outcome}</Badge>
            <span>&middot; Stage: {application.stage.name}</span>
            <span>&middot; Owner: {application.owner.name}</span>
            {canEdit ? (
              <ApplicationOwnerEditor
                applicationId={application.id}
                version={application.version}
                currentOwnerId={application.owner.id}
              />
            ) : null}
          </p>
        </div>
      </div>

      <ApplicationDuplicateCheck priorApplications={priorApplications} />

      {canEdit && application.outcome === "ACTIVE" ? (
        <ApplicationTransitionActions
          applicationId={application.id}
          jobId={application.jobId}
          currentStageId={application.stage.id}
          version={application.version}
          rejectionReasons={rejectionReasons}
        />
      ) : null}

      {application.outcome !== "ACTIVE" ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            <p>
              {application.outcome === "REJECTED" ? "Rejected" : "Withdrawn"}
              {application.outcomeReason ? ` — ${application.outcomeReason.label}` : ""}
              {application.outcomeAt ? ` on ${new Date(application.outcomeAt).toLocaleString()}` : ""}.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interviews</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationInterviews
            applicationId={application.id}
            interviews={interviews}
            canSchedule={canScheduleInterview}
            currentUserId={currentUserId}
            cancellationReasons={cancellationReasons}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offers</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationOffers
            applicationId={application.id}
            offers={offers}
            canCreate={canCreateOffer}
            outcomeReasons={offerOutcomeReasons}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CustomFieldsFormSection
            entityType="APPLICATION"
            value={customFields}
            onChange={setCustomFields}
            disabled={!canEdit}
          />
          {canEdit ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={saveCustomFields} disabled={savingFields}>
                {savingFields ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage & outcome history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {application.events.map((event, index) => (
            <div key={event.id}>
              {index > 0 ? <Separator className="mb-3" /> : null}
              <p className="text-sm">
                <span className="font-medium">{EVENT_LABEL[event.type]}</span>
                {event.type === "STAGE_CHANGE" ? (
                  <>
                    {" "}
                    {event.fromStage ? `${event.fromStage.name} → ` : ""}
                    {event.toStage?.name}
                  </>
                ) : (
                  event.reason ? ` — ${event.reason.label}` : ""
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {event.actor.name} &middot; {new Date(event.createdAt).toLocaleString()}
              </p>
              {event.note ? <p className="mt-1 text-sm text-muted-foreground">{event.note}</p> : null}
            </div>
          ))}
          {application.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stage changes yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
