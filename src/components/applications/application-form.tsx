"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { ParentJobPicker } from "@/components/jobs/parent-job-picker";
import { CandidatePicker, type CandidateOption } from "@/components/applications/candidate-picker";
import {
  ApplicationDuplicateCheck,
  type PriorApplication,
} from "@/components/applications/application-duplicate-check";

type JobOption = { id: string; title: string };
type StageOption = { id: string; name: string; isActive: boolean };

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

export function ApplicationForm({
  initialCandidate,
  initialJob,
}: {
  initialCandidate: CandidateOption | null;
  initialJob: JobOption | null;
}) {
  const router = useRouter();
  const [candidate, setCandidate] = useState<CandidateOption | null>(initialCandidate);
  const [job, setJob] = useState<JobOption | null>(initialJob);
  const [stages, setStages] = useState<StageOption[] | null>(null);
  const [stageId, setStageId] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [priorApplications, setPriorApplications] = useState<PriorApplication[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Job's active stages, so the user can optionally override the default
  // (the job's first stage) — reset whenever the job selection changes.
  useEffect(() => {
    setStageId("");
    if (!job) {
      setStages(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/jobs/${job.id}/pipeline-stages`)
      .then((response) => response.json())
      .then((data: StageOption[]) => {
        if (!cancelled) setStages(data.filter((stage) => stage.isActive));
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  // Non-blocking re-add warning (§11.4) — runs as soon as both sides are picked.
  useEffect(() => {
    if (!candidate || !job) {
      setPriorApplications([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/applications/duplicates?candidateId=${candidate.id}&jobId=${job.id}`)
      .then((response) => response.json())
      .then((data: { priorApplications: PriorApplication[] }) => {
        if (!cancelled) setPriorApplications(data.priorApplications ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [candidate, job]);

  async function handleSubmit() {
    if (!candidate) {
      toast.error("Select a candidate.");
      return;
    }
    if (!job) {
      toast.error("Select a job.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await requestJson("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          candidateId: candidate.id,
          jobId: job.id,
          stageId: stageId || undefined,
          customFields,
        }),
      });
      toast.success("Application created.");
      router.push(`/applications/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create application");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Label>Candidate</Label>
        <CandidatePicker value={candidate} onChange={setCandidate} />
      </div>

      <div className="space-y-2">
        <Label>Job</Label>
        <ParentJobPicker value={job} onChange={setJob} />
      </div>

      {candidate && job ? <ApplicationDuplicateCheck priorApplications={priorApplications} /> : null}

      {job ? (
        <div className="space-y-2">
          <Label>Starting stage (optional — defaults to the first stage)</Label>
          {stages === null ? (
            <p className="text-sm text-muted-foreground">Loading stages…</p>
          ) : (
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Default stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : null}

      <CustomFieldsFormSection entityType="APPLICATION" value={customFields} onChange={setCustomFields} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Save />}
          Create application
        </Button>
      </div>
    </div>
  );
}
