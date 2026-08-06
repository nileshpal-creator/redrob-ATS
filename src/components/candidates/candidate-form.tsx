"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { TagInput } from "@/components/ui/tag-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import {
  CandidateDuplicateCheck,
  type DuplicateMatch,
} from "@/components/candidates/candidate-duplicate-check";
import { ExperienceHistoryEditor, type ExperienceEntry } from "@/components/candidates/experience-history-editor";
import { EducationHistoryEditor, type EducationEntry } from "@/components/candidates/education-history-editor";

type ListValue = { id: string; label: string };

export type CandidateFormValues = {
  name: string;
  phone: string;
  email: string;
  location: string;
  currentCompensation: string;
  expectedCompensation: string;
  noticePeriodDays: string;
  earliestAvailability: string;
  totalExperienceYears: string;
  skills: string[];
  tags: string[];
  sourceId: string;
  experienceHistory: ExperienceEntry[];
  educationHistory: EducationEntry[];
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

function toNumberOrUndefined(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

function toExperienceHistoryPayload(entries: ExperienceEntry[]) {
  return entries
    .filter((entry) => entry.company.trim() && entry.title.trim() && entry.startDate)
    .map((entry) => ({
      company: entry.company,
      title: entry.title,
      startDate: entry.startDate,
      endDate: entry.endDate || undefined,
      description: entry.description || undefined,
    }));
}

function toEducationHistoryPayload(entries: EducationEntry[]) {
  return entries
    .filter((entry) => entry.institution.trim() && entry.degree.trim())
    .map((entry) => ({
      institution: entry.institution,
      degree: entry.degree,
      fieldOfStudy: entry.fieldOfStudy || undefined,
      startYear: entry.startYear ? Number(entry.startYear) : undefined,
      endYear: entry.endYear ? Number(entry.endYear) : undefined,
    }));
}

export function CandidateForm({
  mode,
  candidateId,
  version,
  sources,
  documentTypes,
  initialValues,
}: {
  mode: "create" | "edit";
  candidateId?: string;
  version?: number;
  sources: ListValue[];
  documentTypes: ListValue[];
  initialValues?: Partial<CandidateFormValues>;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<CandidateFormValues>({
    name: initialValues?.name ?? "",
    phone: initialValues?.phone ?? "",
    email: initialValues?.email ?? "",
    location: initialValues?.location ?? "",
    currentCompensation: initialValues?.currentCompensation ?? "",
    expectedCompensation: initialValues?.expectedCompensation ?? "",
    noticePeriodDays: initialValues?.noticePeriodDays ?? "",
    earliestAvailability: initialValues?.earliestAvailability ?? "",
    totalExperienceYears: initialValues?.totalExperienceYears ?? "",
    skills: initialValues?.skills ?? [],
    tags: initialValues?.tags ?? [],
    sourceId: initialValues?.sourceId ?? "",
    experienceHistory: initialValues?.experienceHistory ?? [],
    educationHistory: initialValues?.educationHistory ?? [],
    customFields: initialValues?.customFields ?? {},
  });
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [documentTypeId, setDocumentTypeId] = useState(
    () => documentTypes.find((type) => type.label.toLowerCase() === "resume")?.id ?? documentTypes[0]?.id ?? "",
  );
  const [hardMatch, setHardMatch] = useState<DuplicateMatch | null>(null);
  const [softMatch, setSoftMatch] = useState<DuplicateMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof CandidateFormValues>(key: K, value: CandidateFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function checkDuplicates() {
    if (mode !== "create" || !values.phone.trim()) {
      setHardMatch(null);
      setSoftMatch(null);
      return;
    }
    const params = new URLSearchParams({ phone: values.phone });
    if (values.email.trim()) params.set("email", values.email);
    const response = await fetch(`/api/candidates/duplicates?${params.toString()}`);
    if (!response.ok) return;
    const body = await response.json();
    setHardMatch(body.hardMatch);
    setSoftMatch(body.softMatch);
  }

  function validate(): string | null {
    if (!values.name.trim()) return "Name is required.";
    if (!values.phone.trim()) return "Phone is required.";
    if (mode === "create" && !consentConfirmed) return "Consent must be confirmed before creating a candidate.";
    if (mode === "create" && hardMatch) return "Resolve the phone-number duplicate before creating this candidate.";
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
        name: values.name,
        phone: values.phone,
        email: values.email || undefined,
        location: values.location || undefined,
        currentCompensation: toNumberOrUndefined(values.currentCompensation),
        expectedCompensation: toNumberOrUndefined(values.expectedCompensation),
        noticePeriodDays: toNumberOrUndefined(values.noticePeriodDays),
        earliestAvailability: values.earliestAvailability || undefined,
        totalExperienceYears: toNumberOrUndefined(values.totalExperienceYears),
        skills: values.skills,
        tags: values.tags,
        sourceId: values.sourceId || undefined,
        experienceHistory: toExperienceHistoryPayload(values.experienceHistory),
        educationHistory: toEducationHistoryPayload(values.educationHistory),
        customFields: values.customFields,
      };

      if (mode === "create") {
        const created = await requestJson("/api/candidates", {
          method: "POST",
          body: JSON.stringify({ ...shared, consentGivenAt: new Date().toISOString() }),
        });

        const resumeFile = fileInputRef.current?.files?.[0];
        if (resumeFile && documentTypeId) {
          const formData = new FormData();
          formData.append("file", resumeFile);
          formData.append("documentTypeId", documentTypeId);
          const uploadResponse = await fetch(`/api/candidates/${created.id}/documents`, {
            method: "POST",
            body: formData,
          });
          if (!uploadResponse.ok) {
            const body = await uploadResponse.json();
            toast.error(body.error ?? "Candidate created, but the document upload failed.");
          }
        }

        toast.success("Candidate created.");
        const query = created.possibleDuplicateOf ? `?possibleDuplicateOf=${created.possibleDuplicateOf}` : "";
        router.push(`/candidates/${created.id}${query}`);
      } else {
        const updated = await requestJson(`/api/candidates/${candidateId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...shared, version }),
        });
        toast.success("Candidate updated.");
        router.push(`/candidates/${updated.id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save candidate");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="candidate-name">Name</Label>
          <Input id="candidate-name" value={values.name} onChange={(event) => update("name", event.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="candidate-phone">Phone</Label>
          <Input
            id="candidate-phone"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
            onBlur={checkDuplicates}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="candidate-email">Email</Label>
          <Input
            id="candidate-email"
            type="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            onBlur={checkDuplicates}
          />
        </div>

        {mode === "create" ? <CandidateDuplicateCheck hardMatch={hardMatch} softMatch={softMatch} /> : null}

        <div className="space-y-2">
          <Label htmlFor="candidate-location">Location</Label>
          <Input
            id="candidate-location"
            value={values.location}
            onChange={(event) => update("location", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="candidate-source">Source</Label>
          <Select
            value={values.sourceId || "NONE"}
            onValueChange={(value) => update("sourceId", value === "NONE" ? "" : value)}
          >
            <SelectTrigger id="candidate-source" className="w-full">
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Current compensation</Label>
          <Input
            type="number"
            min={0}
            value={values.currentCompensation}
            onChange={(event) => update("currentCompensation", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Expected compensation</Label>
          <Input
            type="number"
            min={0}
            value={values.expectedCompensation}
            onChange={(event) => update("expectedCompensation", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Notice period (days)</Label>
          <Input
            type="number"
            min={0}
            value={values.noticePeriodDays}
            onChange={(event) => update("noticePeriodDays", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Earliest availability</Label>
          <Input
            type="date"
            value={values.earliestAvailability}
            onChange={(event) => update("earliestAvailability", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Total experience (years)</Label>
          <Input
            type="number"
            min={0}
            step="0.5"
            value={values.totalExperienceYears}
            onChange={(event) => update("totalExperienceYears", event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Skills</Label>
          <TagInput value={values.skills} onChange={(next) => update("skills", next)} placeholder="Type and press Enter" />
        </div>
        <div className="space-y-2">
          <Label>Tags</Label>
          <TagInput value={values.tags} onChange={(next) => update("tags", next)} placeholder="Type and press Enter" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Professional experience</Label>
        <ExperienceHistoryEditor
          value={values.experienceHistory}
          onChange={(next) => update("experienceHistory", next)}
        />
      </div>

      <div className="space-y-2">
        <Label>Education</Label>
        <EducationHistoryEditor value={values.educationHistory} onChange={(next) => update("educationHistory", next)} />
      </div>

      {mode === "create" ? (
        <div className="space-y-2 rounded-md border p-4">
          <Label>Resume (optional)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input id="candidate-resume-file" ref={fileInputRef} type="file" className="text-sm" />
            {documentTypes.length > 0 ? (
              <Select value={documentTypeId} onValueChange={setDocumentTypeId}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Document type" />
                </SelectTrigger>
                <SelectContent>
                  {documentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Attached after the candidate is created.</p>
        </div>
      ) : null}

      <CustomFieldsFormSection
        entityType="CANDIDATE"
        value={values.customFields}
        onChange={(next) => update("customFields", next)}
      />

      {mode === "create" ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={consentConfirmed} onCheckedChange={(checked) => setConsentConfirmed(checked === true)} />
          <span>
            I confirm this candidate&apos;s consent has been captured, per the organization&apos;s data-handling
            policy.
          </span>
        </label>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Save />}
          {mode === "create" ? "Create candidate" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
