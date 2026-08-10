import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY } from "@/lib/entity-registry";
import { getEffectiveScope, getTeamMemberIds } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";

/**
 * Read-only counts for the dashboard's "what's happening / what needs
 * attention" summary. Every count is `null` when the viewer can't read
 * that entity at all (mirrors (app)/layout.tsx's own nav-visibility
 * `can()` checks — a KPI never appears for a module the sidebar itself
 * hides), and otherwise scoped exactly the way each module's own list
 * service scopes its records (OWN/TEAM/ALL via getEffectiveScope, the same
 * helper listJobs/listCandidates/etc. use), so a recruiter sees "their"
 * numbers, not the whole org's. These are vanity counts for the dashboard
 * only — they grant no access themselves; clicking through still goes
 * through each module's own list page and its own RBAC.
 */
export type DashboardOverview = {
  openJobs: number | null;
  activePipeline: number | null;
  interviewsToday: number | null;
  offersAwaitingAction: number | null;
  myOpenTasks: number;
};

export async function getDashboardOverview(context: SessionContext): Promise<DashboardOverview> {
  const [jobScope, applicationScope, interviewScope, offerScope, myOpenTasks] = await Promise.all([
    getEffectiveScope(context, ENTITY.JOB, "READ"),
    getEffectiveScope(context, ENTITY.APPLICATION, "READ"),
    getEffectiveScope(context, ENTITY.INTERVIEW, "READ"),
    getEffectiveScope(context, ENTITY.OFFER, "READ"),
    prisma.workflowTask.count({ where: { assignedToId: context.userId, status: "OPEN" } }),
  ]);

  let openJobs: number | null = null;
  if (jobScope) {
    let ownerFilter: Prisma.JobWhereInput = {};
    if (jobScope === "OWN") ownerFilter = { primaryRecruiterId: context.userId };
    else if (jobScope === "TEAM") ownerFilter = { primaryRecruiterId: { in: await getTeamMemberIds(context.userId) } };
    openJobs = await prisma.job.count({ where: { ...ownerFilter, status: "OPEN" } });
  }

  let activePipeline: number | null = null;
  if (applicationScope) {
    let ownerFilter: Prisma.ApplicationWhereInput = {};
    if (applicationScope === "OWN") ownerFilter = { ownerId: context.userId };
    else if (applicationScope === "TEAM") ownerFilter = { ownerId: { in: await getTeamMemberIds(context.userId) } };
    activePipeline = await prisma.application.count({ where: { ...ownerFilter, outcome: "ACTIVE" } });
  }

  let interviewsToday: number | null = null;
  if (interviewScope) {
    let ownerFilter: Prisma.InterviewWhereInput = {};
    if (interviewScope === "OWN") {
      ownerFilter = { OR: [{ scheduledById: context.userId }, { panelists: { some: { userId: context.userId } } }] };
    } else if (interviewScope === "TEAM") {
      ownerFilter = { scheduledById: { in: await getTeamMemberIds(context.userId) } };
    }
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    interviewsToday = await prisma.interview.count({
      where: { ...ownerFilter, status: "SCHEDULED", scheduledAt: { gte: startOfToday, lt: startOfTomorrow } },
    });
  }

  let offersAwaitingAction: number | null = null;
  if (offerScope) {
    let ownerFilter: Prisma.OfferWhereInput = {};
    if (offerScope === "OWN") ownerFilter = { createdById: context.userId };
    else if (offerScope === "TEAM") ownerFilter = { createdById: { in: await getTeamMemberIds(context.userId) } };
    offersAwaitingAction = await prisma.offer.count({
      where: { ...ownerFilter, status: { in: ["PENDING_APPROVAL", "APPROVED", "EXTENDED"] } },
    });
  }

  return { openJobs, activePipeline, interviewsToday, offersAwaitingAction, myOpenTasks };
}
