import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getJobById } from "@/lib/services/jobs";
import { listApplications } from "@/lib/services/applications";
import { getPipelineStages } from "@/lib/services/pipeline-stages";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { JobPipelineClient } from "@/components/jobs/job-pipeline-client";

export default async function JobPipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const job = await getJobById(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/jobs");
    throw error;
  });

  const [applicationsResult, stages, rejectionReasons, canManageStages] = await Promise.all([
    listApplications(context, { jobId: id, page: 1, pageSize: 100 }),
    getPipelineStages(context, id),
    getControlledListValues("REJECTION_REASON"),
    can(context, ENTITY.JOB, "UPDATE", { ownerId: job.primaryRecruiterId }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{job.title} — Pipeline</h1>
        <p className="text-muted-foreground">Board and list views share the same applications.</p>
      </div>
      <JobPipelineClient
        jobId={id}
        initialApplications={JSON.parse(JSON.stringify(applicationsResult.applications))}
        initialStages={JSON.parse(JSON.stringify(stages))}
        rejectionReasons={rejectionReasons.values}
        canManageStages={canManageStages}
      />
    </div>
  );
}
