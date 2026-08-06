import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getAvailableTransitions, getJobById } from "@/lib/services/jobs";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { JobDetailClient } from "@/components/jobs/job-detail-client";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const job = await getJobById(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/jobs");
    throw error;
  });

  const [availableTransitions, canEditFields, canManageRecruiters, holdReasons, closeReasons, cancelReasons] =
    await Promise.all([
      getAvailableTransitions(context, job),
      can(context, ENTITY.JOB, "UPDATE", { ownerId: job.primaryRecruiterId }),
      can(context, ENTITY.JOB, "UPDATE", { ownerId: job.primaryRecruiterId }),
      getControlledListValues("JOB_HOLD_REASON"),
      getControlledListValues("JOB_CLOSE_REASON"),
      getControlledListValues("JOB_CANCEL_REASON"),
    ]);

  return (
    <JobDetailClient
      job={JSON.parse(JSON.stringify(job))}
      availableTransitions={availableTransitions}
      canEdit={canEditFields}
      canManageRecruiters={canManageRecruiters}
      reasonsByListKey={{
        JOB_HOLD_REASON: holdReasons.values,
        JOB_CLOSE_REASON: closeReasons.values,
        JOB_CANCEL_REASON: cancelReasons.values,
      }}
    />
  );
}
