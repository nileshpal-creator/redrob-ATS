import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getJobById } from "@/lib/services/jobs";
import { listApplications } from "@/lib/services/applications";
import { getPipelineStages } from "@/lib/services/pipeline-stages";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { BackLink } from "@/components/layout/back-link";
import { JobPipelineClient } from "@/components/jobs/job-pipeline-client";

// The board and list views both need every application on the job in one
// shot (the board groups by stage client-side; paginating either view
// would split a stage's cards across pages, which doesn't make sense for a
// kanban board) — see docs/project-status.md's Known Limitations entry this
// closes: a fixed pageSize: 100 silently dropped applications beyond the
// 100th on high-volume jobs. Bounded rather than truly unbounded so one
// pathological job can't make this page fetch/serialize an unbounded
// row-set; the truncation banner below makes it visible instead of silent
// if a job ever does exceed the cap (unreachable in practice today).
const PIPELINE_APPLICATIONS_CAP = 2000;

export default async function JobPipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const job = await getJobById(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/jobs");
    throw error;
  });

  const [firstBatch, stages, rejectionReasons, canManageStages] = await Promise.all([
    listApplications(context, { jobId: id, page: 1, pageSize: 100 }),
    getPipelineStages(context, id),
    getControlledListValues("REJECTION_REASON"),
    can(context, ENTITY.JOB, "UPDATE", { ownerId: job.primaryRecruiterId }),
  ]);

  const applicationsResult =
    firstBatch.total <= firstBatch.applications.length
      ? firstBatch
      : await listApplications(context, {
          jobId: id,
          page: 1,
          pageSize: Math.min(firstBatch.total, PIPELINE_APPLICATIONS_CAP),
        });
  const truncatedCount = applicationsResult.total - applicationsResult.applications.length;

  return (
    <div className="space-y-4">
      <BackLink href={`/jobs/${id}`} label={job.title} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{job.title} — Pipeline</h1>
        <p className="text-muted-foreground">Board and list views share the same applications.</p>
      </div>
      {truncatedCount > 0 ? (
        <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          Showing the first {applicationsResult.applications.length} of {applicationsResult.total} applications on
          this job. Use the global{" "}
          <a href={`/applications?jobId=${id}`} className="underline">
            Applications list
          </a>{" "}
          to see the rest.
        </p>
      ) : null}
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
