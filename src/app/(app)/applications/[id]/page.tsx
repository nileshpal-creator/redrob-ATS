import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getApplication } from "@/lib/services/applications";
import { listInterviews } from "@/lib/services/interviews";
import { listOffers } from "@/lib/services/offers";
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

  const [
    canEdit,
    rejectionReasons,
    cancellationReasons,
    offerOutcomeReasons,
    canScheduleInterview,
    canCreateOffer,
    interviewsResult,
    offersResult,
  ] = await Promise.all([
    can(context, ENTITY.APPLICATION, "UPDATE", { ownerId: application.ownerId }),
    getControlledListValues("REJECTION_REASON"),
    getControlledListValues("INTERVIEW_CANCELLATION_REASON"),
    getControlledListValues("OFFER_OUTCOME_REASON"),
    can(context, ENTITY.INTERVIEW, "CREATE"),
    can(context, ENTITY.OFFER, "CREATE"),
    listInterviews(context, { applicationId: id, page: 1, pageSize: 50 }).catch((error) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
    listOffers(context, { applicationId: id, page: 1, pageSize: 50 }).catch((error) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
  ]);

  // Compute each manage-scope once rather than calling can() per row — every
  // call would re-run the identical role/resource/action grant lookup.
  const interviewManageScope = interviewsResult ? await getEffectiveScope(context, ENTITY.INTERVIEW, "UPDATE") : null;
  const offerManageScope = offersResult ? await getEffectiveScope(context, ENTITY.OFFER, "UPDATE") : null;
  const offerApproveScope = offersResult ? await getEffectiveScope(context, ENTITY.OFFER, "APPROVE") : null;
  const needsTeamIds = [interviewManageScope, offerManageScope, offerApproveScope].includes("TEAM");
  const teamIds = needsTeamIds ? await getTeamMemberIds(context.userId) : null;
  const currentUserId = context.userId;

  function scopeIncludes(scope: string | null, ownerId: string) {
    return (
      scope === "ALL" ||
      (scope === "OWN" && ownerId === currentUserId) ||
      (scope === "TEAM" && (teamIds?.includes(ownerId) ?? false))
    );
  }

  const interviews = interviewsResult
    ? interviewsResult.interviews.map((interview) => ({
        ...interview,
        canManage: scopeIncludes(interviewManageScope, interview.scheduledById),
      }))
    : [];

  const offers = offersResult
    ? offersResult.offers.map((offer) => ({
        ...offer,
        canManage: scopeIncludes(offerManageScope, offer.createdById),
        canApprove: scopeIncludes(offerApproveScope, offer.createdById),
      }))
    : [];

  return (
    <ApplicationDetailClient
      application={JSON.parse(JSON.stringify(application))}
      canEdit={canEdit}
      rejectionReasons={rejectionReasons.values}
      interviews={JSON.parse(JSON.stringify(interviews))}
      canScheduleInterview={canScheduleInterview}
      cancellationReasons={cancellationReasons.values}
      offers={JSON.parse(JSON.stringify(offers))}
      canCreateOffer={canCreateOffer}
      offerOutcomeReasons={offerOutcomeReasons.values}
      currentUserId={context.userId}
    />
  );
}
