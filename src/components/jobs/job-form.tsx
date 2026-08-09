"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { RecruiterPicker, type RecruiterAssignment } from "@/components/jobs/recruiter-picker";
import { ParentJobPicker } from "@/components/jobs/parent-job-picker";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";

type ListValue = { id: string; label: string };

const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export type JobFormValues = {
  title: string;
  departmentId: string;
  locationId: string;
  employmentType: string;
  priority: string;
  positionsCount: number;
  targetDate: string;
  description: string;
  mustHaveCriteria: string[];
  goodToHaveCriteria: string[];
  parentJob: { id: string; title: string } | null;
  customFields: Record<string, unknown>;
};

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

export function JobForm({
  mode,
  jobId,
  version,
  departments,
  locations,
  initialValues,
}: {
  mode: "create" | "edit";
  jobId?: string;
  version?: number;
  departments: ListValue[];
  locations: ListValue[];
  initialValues?: Partial<JobFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<JobFormValues>({
    title: initialValues?.title ?? "",
    departmentId: initialValues?.departmentId ?? "",
    locationId: initialValues?.locationId ?? "",
    employmentType: initialValues?.employmentType ?? "",
    priority: initialValues?.priority ?? "",
    positionsCount: initialValues?.positionsCount ?? 1,
    targetDate: initialValues?.targetDate ?? "",
    description: initialValues?.description ?? "",
    mustHaveCriteria: initialValues?.mustHaveCriteria ?? [],
    goodToHaveCriteria: initialValues?.goodToHaveCriteria ?? [],
    parentJob: initialValues?.parentJob ?? null,
    customFields: initialValues?.customFields ?? {},
  });
  const [recruiters, setRecruiters] = useState<RecruiterAssignment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesWarning(dirty && !submitting);

  function update<K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function updateRecruiters(next: RecruiterAssignment[]) {
    setRecruiters(next);
    setDirty(true);
  }

  function validate(): string | null {
    if (!values.title.trim()) return "Title is required.";
    if (!values.departmentId) return "Department is required.";
    if (!values.locationId) return "Location is required.";
    if (!values.employmentType) return "Employment type is required.";
    if (!values.priority) return "Priority is required.";
    if (!values.positionsCount || values.positionsCount < 1) return "Positions must be at least 1.";
    if (mode === "create" && recruiters.length === 0) return "Assign at least one recruiter.";
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const shared = {
        title: values.title,
        departmentId: values.departmentId,
        locationId: values.locationId,
        employmentType: values.employmentType,
        priority: values.priority,
        positionsCount: values.positionsCount,
        targetDate: values.targetDate || undefined,
        description: values.description || undefined,
        mustHaveCriteria: values.mustHaveCriteria,
        goodToHaveCriteria: values.goodToHaveCriteria,
        parentJobId: values.parentJob?.id,
        customFields: values.customFields,
      };

      if (mode === "create") {
        const primary = recruiters.find((assignment) => assignment.isPrimary);
        const created = await requestJson("/api/jobs", {
          method: "POST",
          body: JSON.stringify({
            ...shared,
            recruiterUserIds: recruiters.map((assignment) => assignment.userId),
            primaryRecruiterUserId: primary?.userId,
          }),
        });
        toast.success("Job created as draft.");
        router.push(`/jobs/${created.id}`);
      } else {
        const updated = await requestJson(`/api/jobs/${jobId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...shared, version }),
        });
        toast.success("Job updated.");
        router.push(`/jobs/${updated.id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Title</Label>
          <Input value={values.title} onChange={(event) => update("title", event.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Department</Label>
          <Select value={values.departmentId} onValueChange={(value) => update("departmentId", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Location</Label>
          <Select value={values.locationId} onValueChange={(value) => update("locationId", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Employment type</Label>
          <Select value={values.employmentType} onValueChange={(value) => update("employmentType", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Priority</Label>
          <Select value={values.priority} onValueChange={(value) => update("priority", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Positions</Label>
          <Input
            type="number"
            min={1}
            value={values.positionsCount}
            onChange={(event) => update("positionsCount", Number(event.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Target date</Label>
          <Input
            type="date"
            value={values.targetDate}
            onChange={(event) => update("targetDate", event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          rows={4}
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Must-have criteria</Label>
          <TagInput
            value={values.mustHaveCriteria}
            onChange={(next) => update("mustHaveCriteria", next)}
            placeholder="Type and press Enter"
          />
        </div>
        <div className="space-y-2">
          <Label>Good-to-have criteria</Label>
          <TagInput
            value={values.goodToHaveCriteria}
            onChange={(next) => update("goodToHaveCriteria", next)}
            placeholder="Type and press Enter"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Parent requisition (optional)</Label>
        <ParentJobPicker
          value={values.parentJob}
          onChange={(job) => update("parentJob", job)}
          excludeJobId={jobId}
        />
      </div>

      {mode === "create" ? (
        <div className="space-y-2">
          <Label>Recruiters</Label>
          <RecruiterPicker value={recruiters} onChange={updateRecruiters} />
        </div>
      ) : null}

      <CustomFieldsFormSection
        entityType="JOB"
        value={values.customFields}
        onChange={(next) => update("customFields", next)}
      />

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Save />}
          {mode === "create" ? "Create job" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
