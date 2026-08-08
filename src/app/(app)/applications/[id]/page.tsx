import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getApplication } from "@/lib/services/applications";
import { listInterviews } from "@/lib/services/interviews";
import { listOffers } from "@/lib/services/offers";
import { listHandoffs } from "@/lib/services/handoffs";
import { listWorkflowTasks } from "@/lib/services/workflow-tasks";
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
    handoffsResult,
    tasksResult,
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
    listHandoffs(context, { applicationId: id, page: 1, pageSize: 50 }).catch((error) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
    listWorkflowTasks(context, { applicationId: id }).catch((error) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
  ]);

  // Compute each manage-scope once rather than calling can() per row — every
  // call would re-run the identical role/resource/action grant lookup.
  const interviewManageScope = interviewsResult ? await getEffectiveScope(context, ENTITY.INTERVIEW, "UPDATE") : null;
  const offerManageScope = offersResult ? await getEffectiveScope(context, ENTITY.OFFER, "UPDATE") : null;
  const offerApproveScope = offersResult ? await getEffectiveScope(context, ENTITY.OFFER, "APPROVE") : null;
  const handoffRetryScope = handoffsResult ? await getEffectiveScope(context, ENTITY.HANDOFF, "UPDATE") : null;
  const handoffAcknowledgeScope = handoffsResult ? await getEffectiveScope(context, ENTITY.HANDOFF, "APPROVE") : null;
  const needsTeamIds = [interviewManageScope, offerManageScope, offerApproveScope, handoffRetryScope, handoffAcknowledgeScope].includes(
    "TEAM",
  );
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

  // §11.6: a configured multi-step chain can require a *specific* role for
  // the currently-pending step, not just any OFFER:APPROVE holder — mirrors
  // assertCanDecideStep in src/lib/services/approvals.ts exactly, so the
  // "Review approval" button never appears for someone the backend would
  // reject anyway. A step with no requiredRoleId is the legacy no-chain
  // row, where the plain scope check is the only gate (unchanged behavior).
  const isSuperAdmin = context.isSuperAdmin;
  const roleIds = context.roles.map((role) => role.id);

  function canDecideCurrentStep(approvals: { stepOrder: number; status: string; requiredRoleId: string | null }[]) {
    const pending = approvals.filter((approval) => approval.status === "PENDING");
    if (pending.length === 0) return false;
    const current = pending.reduce((min, approval) => (approval.stepOrder < min.stepOrder ? approval : min));
    if (!current.requiredRoleId) return true;
    return isSuperAdmin || roleIds.includes(current.requiredRoleId);
  }

  const offers = offersResult
    ? offersResult.offers.map((offer) => ({
        ...offer,
        canManage: scopeIncludes(offerManageScope, offer.createdById),
        canApprove: scopeIncludes(offerApproveScope, offer.createdById) && canDecideCurrentStep(offer.approvals),
      }))
    : [];

  const handoffs = handoffsResult
    ? handoffsResult.handoffs.map((handoff) => ({
        ...handoff,
        canRetry: scopeIncludes(handoffRetryScope, handoff.initiatedById),
        canAcknowledge: scopeIncludes(handoffAcknowledgeScope, handoff.initiatedById),
      }))
    : [];

  const tasks = tasksResult ?? [];

  // Sole source of truth for the read-only/archive banner — mirrors
  // assertApplicationNotHandedOff's server-side check exactly (see
  // src/lib/services/handoffs.ts) so the UI never shows action buttons the
  // API would reject anyway.
  const isArchivedByHandoff = handoffs.some((handoff) => handoff.status === "ACCEPTED");

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
      handoffs={JSON.parse(JSON.stringify(handoffs))}
      isArchivedByHandoff={isArchivedByHandoff}
      tasks={JSON.parse(JSON.stringify(tasks))}
      currentUserId={context.userId}
    />
  );
}
