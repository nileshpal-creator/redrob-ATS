import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getJobById } from "@/lib/services/jobs";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { JobForm } from "@/components/jobs/job-form";

function toDateInputValue(date: Date | null) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const job = await getJobById(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/jobs");
    throw error;
  });

  const canEdit = await can(context, ENTITY.JOB, "UPDATE", { ownerId: job.primaryRecruiterId });
  if (!canEdit) {
    redirect(`/jobs/${id}`);
  }

  const [departments, locations] = await Promise.all([
    getControlledListValues("DEPARTMENT"),
    getControlledListValues("LOCATION"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {job.title}</h1>
      </div>
      <JobForm
        mode="edit"
        jobId={job.id}
        version={job.version}
        departments={departments.values}
        locations={locations.values}
        initialValues={{
          title: job.title,
          departmentId: job.departmentId,
          locationId: job.locationId,
          employmentType: job.employmentType,
          priority: job.priority,
          positionsCount: job.positionsCount,
          targetDate: toDateInputValue(job.targetDate),
          description: job.description ?? "",
          mustHaveCriteria: job.mustHaveCriteria,
          goodToHaveCriteria: job.goodToHaveCriteria,
          parentJob: job.parentJob ? { id: job.parentJob.id, title: job.parentJob.title } : null,
          customFields: (job.customFields as Record<string, unknown>) ?? {},
        }}
      />
    </div>
  );
}
