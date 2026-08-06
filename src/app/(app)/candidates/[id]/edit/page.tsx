import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getCandidateById } from "@/lib/services/candidates";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { CandidateForm } from "@/components/candidates/candidate-form";

function toDateInputValue(date: Date | string | null) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export default async function EditCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const candidate = await getCandidateById(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/candidates");
    throw error;
  });

  const canEdit = await can(context, ENTITY.CANDIDATE, "UPDATE", { ownerId: candidate.createdById });
  if (!canEdit) {
    redirect(`/candidates/${id}`);
  }

  const [sources, documentTypes] = await Promise.all([
    getControlledListValues("CANDIDATE_SOURCE"),
    getControlledListValues("DOCUMENT_TYPE"),
  ]);

  const experienceHistory = (
    (candidate.experienceHistory as { company: string; title: string; startDate: string; endDate?: string; description?: string }[] | null) ?? []
  ).map((entry) => ({
    company: entry.company,
    title: entry.title,
    startDate: toDateInputValue(entry.startDate),
    endDate: entry.endDate ? toDateInputValue(entry.endDate) : "",
    description: entry.description ?? "",
  }));

  const educationHistory = (
    (candidate.educationHistory as { institution: string; degree: string; fieldOfStudy?: string; startYear?: number; endYear?: number }[] | null) ?? []
  ).map((entry) => ({
    institution: entry.institution,
    degree: entry.degree,
    fieldOfStudy: entry.fieldOfStudy ?? "",
    startYear: entry.startYear ? String(entry.startYear) : "",
    endYear: entry.endYear ? String(entry.endYear) : "",
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {candidate.name}</h1>
      </div>
      <CandidateForm
        mode="edit"
        candidateId={candidate.id}
        version={candidate.version}
        sources={sources.values}
        documentTypes={documentTypes.values}
        initialValues={{
          name: candidate.name,
          phone: candidate.phone,
          email: candidate.email ?? "",
          location: candidate.location ?? "",
          currentCompensation: candidate.currentCompensation?.toString() ?? "",
          expectedCompensation: candidate.expectedCompensation?.toString() ?? "",
          noticePeriodDays: candidate.noticePeriodDays?.toString() ?? "",
          earliestAvailability: toDateInputValue(candidate.earliestAvailability),
          totalExperienceYears: candidate.totalExperienceYears?.toString() ?? "",
          skills: candidate.skills,
          tags: candidate.tags,
          sourceId: candidate.sourceId ?? "",
          experienceHistory,
          educationHistory,
          customFields: (candidate.customFields as Record<string, unknown>) ?? {},
        }}
      />
    </div>
  );
}
