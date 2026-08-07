import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getApplication } from "@/lib/services/applications";
import { listInterviews } from "@/lib/services/interviews";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { ApplicationDetailClient } from "@/components/applications/application-detail-client";

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const application = await getApplication(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/applications");
    throw error;
  });

  const [canEdit, rejectionReasons, cancellationReasons, canScheduleInterview, interviewsResult] = await Promise.all([
    can(context, ENTITY.APPLICATION, "UPDATE", { ownerId: application.ownerId }),
    getControlledListValues("REJECTION_REASON"),
    getControlledListValues("INTERVIEW_CANCELLATION_REASON"),
    can(context, ENTITY.INTERVIEW, "CREATE"),
    listInterviews(context, { applicationId: id, page: 1, pageSize: 50 }).catch((error) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
  ]);

  const interviews = interviewsResult
    ? await Promise.all(
        interviewsResult.interviews.map(async (interview) => ({
          ...interview,
          canManage: await can(context, ENTITY.INTERVIEW, "UPDATE", { ownerId: interview.scheduledById }),
        })),
      )
    : [];

  return (
    <ApplicationDetailClient
      application={JSON.parse(JSON.stringify(application))}
      canEdit={canEdit}
      rejectionReasons={rejectionReasons.values}
      interviews={JSON.parse(JSON.stringify(interviews))}
      canScheduleInterview={canScheduleInterview}
      cancellationReasons={cancellationReasons.values}
      currentUserId={context.userId}
    />
  );
}
