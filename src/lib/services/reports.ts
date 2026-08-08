import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY } from "@/lib/entity-registry";
import { ForbiddenError, getEffectiveScope, getTeamMemberIds } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { NotFoundError } from "@/lib/errors";
import { businessDaysBetween, getWorkingCalendar } from "@/lib/reporting/business-days";
import type {
  OfferTatComplianceQuery,
  PipelineFunnelQuery,
  RecruiterProductivityQuery,
  TimeToFillOfferQuery,
} from "@/lib/validations/report";

const userSummarySelect = { id: true, name: true, email: true } as const;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dateRangeFilter(dateFrom?: Date, dateTo?: Date): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
}

/**
 * Every report below reuses the underlying entity's own :READ permission and
 * scope — the same "reports reuse the entity's existing permission" choice
 * candidate-export.ts documents for CANDIDATE:READ — rather than a new
 * blanket REPORT resource. Row-level security (§10.5) falls out of this for
 * free: an OWN/TEAM-scoped viewer's report is narrowed exactly like their
 * own Job/Application/Offer lists are.
 */
async function resolveJobOwnerFilter(context: SessionContext): Promise<Prisma.JobWhereInput> {
  const scope = await getEffectiveScope(context, ENTITY.JOB, "READ");
  if (!scope) throw new ForbiddenError();
  if (scope === "ALL") return {};
  if (scope === "OWN") return { primaryRecruiterId: context.userId };
  return { primaryRecruiterId: { in: await getTeamMemberIds(context.userId) } };
}

async function resolveOfferOwnerFilter(context: SessionContext): Promise<Prisma.OfferWhereInput> {
  const scope = await getEffectiveScope(context, ENTITY.OFFER, "READ");
  if (!scope) throw new ForbiddenError();
  if (scope === "ALL") return {};
  if (scope === "OWN") return { createdById: context.userId };
  return { createdById: { in: await getTeamMemberIds(context.userId) } };
}

/**
 * Pipeline funnel & conversion (§11.12) — job is required since
 * PipelineStage is job-scoped (each job orders its own stages), unlike a
 * global stage vocabulary. recruiter/source/date-range narrow the
 * Application set before the funnel is computed.
 *
 * "Reached stage N" is a cumulative reach count — an application counts
 * toward every stage it currently sits at, or has any ApplicationEvent
 * recording a move into or out of (STAGE_CHANGE's toStageId AND fromStageId
 * — fromStageId matters too, since an application's *initial* stage never
 * appears as any event's toStageId), not just its current stage, so the
 * funnel shows drop-off rather than only a point-in-time distribution.
 * Conversion rate stage i -> i+1 is reached(i+1)/reached(i).
 */
export async function getPipelineFunnelReport(context: SessionContext, query: PipelineFunnelQuery) {
  const ownerFilter = await resolveJobOwnerFilter(context);
  const job = await prisma.job.findFirst({
    where: { id: query.jobId, ...ownerFilter },
    select: {
      id: true,
      title: true,
      pipelineStages: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sortOrder: true } },
    },
  });
  if (!job) {
    const exists = await prisma.job.findUnique({ where: { id: query.jobId }, select: { id: true } });
    throw exists ? new ForbiddenError() : new NotFoundError("Job not found.");
  }

  const createdAtFilter = dateRangeFilter(query.dateFrom, query.dateTo);
  const applicationWhere: Prisma.ApplicationWhereInput = {
    jobId: job.id,
    ...(query.recruiterId ? { ownerId: query.recruiterId } : {}),
    ...(query.sourceId ? { candidate: { sourceId: query.sourceId } } : {}),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };

  const [applications, events] = await Promise.all([
    prisma.application.findMany({ where: applicationWhere, select: { id: true, stageId: true } }),
    prisma.applicationEvent.findMany({
      where: { application: applicationWhere, type: "STAGE_CHANGE" },
      select: { applicationId: true, fromStageId: true, toStageId: true },
    }),
  ]);

  const reachedByStage = new Map<string, Set<string>>();
  const currentByStage = new Map<string, number>();
  for (const application of applications) {
    currentByStage.set(application.stageId, (currentByStage.get(application.stageId) ?? 0) + 1);
    reachedByStage.set(application.stageId, (reachedByStage.get(application.stageId) ?? new Set()).add(application.id));
  }
  for (const event of events) {
    // Both ends of every move count as "reached" — toStageId is where it
    // arrived, but fromStageId matters too: an application's *initial*
    // stage (assigned at creation, before its first move) never appears as
    // any event's toStageId, since nothing "moved it into" a stage it
    // started at. Without fromStageId here, any application that has since
    // progressed past its starting stage would silently disappear from
    // that stage's reached count.
    for (const stageId of [event.fromStageId, event.toStageId]) {
      if (!stageId) continue;
      reachedByStage.set(stageId, (reachedByStage.get(stageId) ?? new Set()).add(event.applicationId));
    }
  }

  let previousReached: number | null = null;
  const stages = job.pipelineStages.map((stage) => {
    const reachedCount = reachedByStage.get(stage.id)?.size ?? 0;
    const conversionFromPrevious = previousReached && previousReached > 0 ? reachedCount / previousReached : null;
    previousReached = reachedCount;
    return {
      stageId: stage.id,
      name: stage.name,
      currentCount: currentByStage.get(stage.id) ?? 0,
      reachedCount,
      conversionFromPrevious,
    };
  });

  return { job: { id: job.id, title: job.title }, totalApplications: applications.length, stages };
}

/**
 * Time-to-fill & time-to-offer (§11.12). Scoped by JOB:READ throughout
 * (including the `recruiterId` filter, which maps to Job.primaryRecruiterId
 * rather than Application.ownerId) since department/location are Job
 * attributes and both metrics are fundamentally about a job's hiring cycle.
 *
 * time-to-fill: Job.createdAt -> the HandoffRecord.createdAt for each hire
 * against that job (HandoffRecord is only ever created once, as a side
 * effect of an Offer's ACCEPT transition — see schema.prisma — so its
 * creation instant is the accurate "hire confirmed" moment regardless of
 * downstream HR delivery status).
 * time-to-offer: Application.createdAt -> the earliest Offer.createdAt for
 * that application.
 */
export async function getTimeToFillOfferReport(context: SessionContext, query: TimeToFillOfferQuery) {
  const ownerFilter = await resolveJobOwnerFilter(context);
  const createdAtFilter = dateRangeFilter(query.dateFrom, query.dateTo);

  const jobs = await prisma.job.findMany({
    where: {
      ...ownerFilter,
      departmentId: query.departmentId,
      locationId: query.locationId,
      ...(query.recruiterId ? { primaryRecruiterId: query.recruiterId } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    select: { id: true, title: true, createdAt: true, department: { select: { label: true } } },
  });
  if (jobs.length === 0) {
    return { jobs: [], overall: { timeToFillDaysAvg: null, timeToOfferDaysAvg: null, hiresCount: 0, offersCount: 0 } };
  }

  const jobIds = jobs.map((job) => job.id);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const calendar = await getWorkingCalendar();

  const [handoffs, applications] = await Promise.all([
    prisma.handoffRecord.findMany({
      where: { application: { jobId: { in: jobIds } } },
      select: { createdAt: true, application: { select: { jobId: true } } },
    }),
    prisma.application.findMany({
      where: { jobId: { in: jobIds } },
      select: { id: true, jobId: true, createdAt: true, offers: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } } },
    }),
  ]);

  const fillDaysByJob = new Map<string, number[]>();
  for (const handoff of handoffs) {
    const job = jobsById.get(handoff.application.jobId);
    if (!job) continue;
    const days = businessDaysBetween(job.createdAt, handoff.createdAt, calendar);
    fillDaysByJob.set(job.id, [...(fillDaysByJob.get(job.id) ?? []), days]);
  }

  const offerDaysByJob = new Map<string, number[]>();
  for (const application of applications) {
    const firstOffer = application.offers[0];
    if (!firstOffer) continue;
    const days = businessDaysBetween(application.createdAt, firstOffer.createdAt, calendar);
    offerDaysByJob.set(application.jobId, [...(offerDaysByJob.get(application.jobId) ?? []), days]);
  }

  const jobRows = jobs.map((job) => {
    const fillDays = fillDaysByJob.get(job.id) ?? [];
    const offerDays = offerDaysByJob.get(job.id) ?? [];
    return {
      jobId: job.id,
      title: job.title,
      departmentLabel: job.department.label,
      timeToFillDaysAvg: average(fillDays),
      hiresCount: fillDays.length,
      timeToOfferDaysAvg: average(offerDays),
      offersCount: offerDays.length,
    };
  });

  const allFillDays = [...fillDaysByJob.values()].flat();
  const allOfferDays = [...offerDaysByJob.values()].flat();

  return {
    jobs: jobRows,
    overall: {
      timeToFillDaysAvg: average(allFillDays),
      hiresCount: allFillDays.length,
      timeToOfferDaysAvg: average(allOfferDays),
      offersCount: allOfferDays.length,
    },
  };
}

/**
 * Recruiter productivity & workload (§11.12) — deliberately mixes snapshot
 * "workload" counts (open jobs, active applications — true right now, not
 * date-ranged) with date-ranged "productivity" activity counts (interviews
 * scheduled / offers extended / hires, within the filter's date range),
 * matching the requirement's own two-word framing.
 */
export async function getRecruiterProductivityReport(context: SessionContext, query: RecruiterProductivityQuery) {
  const scope = await getEffectiveScope(context, ENTITY.JOB, "READ");
  if (!scope) throw new ForbiddenError();

  let recruiterIds: string[];
  if (query.recruiterId) {
    if (scope === "OWN" && query.recruiterId !== context.userId) throw new ForbiddenError();
    if (scope === "TEAM" && !(await getTeamMemberIds(context.userId)).includes(query.recruiterId)) {
      throw new ForbiddenError();
    }
    recruiterIds = [query.recruiterId];
  } else if (scope === "OWN") {
    recruiterIds = [context.userId];
  } else if (scope === "TEAM") {
    recruiterIds = await getTeamMemberIds(context.userId);
  } else {
    const distinctRecruiters = await prisma.job.findMany({ distinct: ["primaryRecruiterId"], select: { primaryRecruiterId: true } });
    recruiterIds = distinctRecruiters.map((row) => row.primaryRecruiterId);
  }

  const createdAtFilter = dateRangeFilter(query.dateFrom, query.dateTo);
  const createdAtWhere = createdAtFilter ? { createdAt: createdAtFilter } : {};

  // One grouped query per metric across every recruiter at once, not one
  // query per recruiter — flat cost regardless of how many recruiters are
  // in scope (a TEAM/ALL-scope call previously ran 5 queries *per
  // recruiter*; groupBy collapses each metric back to a single query).
  const [recruiters, openJobsGroups, activeApplicationsGroups, interviewsGroups, offersGroups, handoffsGroups] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: recruiterIds } }, select: userSummarySelect }),
    prisma.job.groupBy({
      by: ["primaryRecruiterId"],
      where: { primaryRecruiterId: { in: recruiterIds }, status: "OPEN" },
      _count: { _all: true },
    }),
    prisma.application.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: recruiterIds }, outcome: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.interview.groupBy({
      by: ["scheduledById"],
      where: { scheduledById: { in: recruiterIds }, ...createdAtWhere },
      _count: { _all: true },
    }),
    prisma.offer.groupBy({
      by: ["createdById"],
      where: { createdById: { in: recruiterIds }, status: { in: ["EXTENDED", "ACCEPTED", "DECLINED"] }, ...createdAtWhere },
      _count: { _all: true },
    }),
    prisma.handoffRecord.groupBy({
      by: ["initiatedById"],
      where: { initiatedById: { in: recruiterIds }, ...createdAtWhere },
      _count: { _all: true },
    }),
  ]);

  const countMap = (groups: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
    new Map(groups.map((group) => [group[key] as string, group._count._all]));

  const openJobsByRecruiter = countMap(openJobsGroups, "primaryRecruiterId");
  const activeApplicationsByRecruiter = countMap(activeApplicationsGroups, "ownerId");
  const interviewsByRecruiter = countMap(interviewsGroups, "scheduledById");
  const offersByRecruiter = countMap(offersGroups, "createdById");
  const handoffsByRecruiter = countMap(handoffsGroups, "initiatedById");

  const rows = recruiters.map((recruiter) => ({
    recruiter,
    openJobsCount: openJobsByRecruiter.get(recruiter.id) ?? 0,
    activeApplicationsCount: activeApplicationsByRecruiter.get(recruiter.id) ?? 0,
    interviewsScheduledCount: interviewsByRecruiter.get(recruiter.id) ?? 0,
    offersExtendedCount: offersByRecruiter.get(recruiter.id) ?? 0,
    hiresCount: handoffsByRecruiter.get(recruiter.id) ?? 0,
  }));

  return { rows };
}

/**
 * Offer/TAT compliance (§11.12). TAT is measured Offer.createdAt -> the
 * approved OfferApproval.decidedAt — the one transition in Offer's
 * lifecycle with its own immutable, never-overwritten timestamp (see
 * OfferApproval's model comment). Offer.updatedAt could not substitute for
 * this: it reflects only the *latest* status flip, so an offer that has
 * since moved past EXTENDED (accepted/declined/revoked) no longer carries
 * an accurate "when was it extended" timestamp anywhere — extending the
 * schema to add one is out of scope for this pass, so compliance is
 * reported on the submission-to-approval leg only, which stays accurate
 * for every offer regardless of what happened to it afterward.
 *
 * `tatThresholdDays` is an optional per-request override of
 * Organization.offerTatThresholdDays (§11.6: "configurable per
 * organization"). A caller who omits it gets the org-wide default; one who
 * supplies it gets exactly that value for this one report run, without
 * touching the stored setting.
 */
export async function getOfferTatComplianceReport(context: SessionContext, query: OfferTatComplianceQuery) {
  const ownerFilter = await resolveOfferOwnerFilter(context);
  const createdAtFilter = dateRangeFilter(query.dateFrom, query.dateTo);
  const tatThresholdDays =
    query.tatThresholdDays ?? (await prisma.organization.findFirst())?.offerTatThresholdDays ?? 3;

  const offers = await prisma.offer.findMany({
    where: {
      ...ownerFilter,
      ...(query.recruiterId ? { createdById: query.recruiterId } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      createdBy: { select: userSummarySelect },
      approvals: { where: { status: "APPROVED" }, orderBy: { decidedAt: "asc" }, take: 1, select: { decidedAt: true } },
    },
  });

  const calendar = await getWorkingCalendar();
  const measured: { offerId: string; recruiter: (typeof offers)[number]["createdBy"]; tatDays: number; compliant: boolean }[] = [];
  let pendingApprovalCount = 0;

  for (const offer of offers) {
    const decidedAt = offer.approvals[0]?.decidedAt;
    if (!decidedAt) {
      pendingApprovalCount += 1;
      continue;
    }
    const tatDays = businessDaysBetween(offer.createdAt, decidedAt, calendar);
    measured.push({ offerId: offer.id, recruiter: offer.createdBy, tatDays, compliant: tatDays <= tatThresholdDays });
  }

  const compliantCount = measured.filter((row) => row.compliant).length;

  return {
    tatThresholdDays,
    measuredCount: measured.length,
    pendingApprovalCount,
    compliantCount,
    complianceRate: measured.length > 0 ? compliantCount / measured.length : null,
    avgTatDays: average(measured.map((row) => row.tatDays)),
    rows: measured,
  };
}
