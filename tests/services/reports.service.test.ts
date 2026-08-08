import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { NotFoundError } from "@/lib/errors";
import {
  getOfferTatComplianceReport,
  getPipelineFunnelReport,
  getRecruiterProductivityReport,
  getTimeToFillOfferReport,
} from "@/lib/services/reports";

function contextFor(user: {
  id: string;
  name: string;
  email: string;
  roles: { id: string; name: string; isSuperAdmin: boolean }[];
}): SessionContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    isSuperAdmin: user.roles.some((role) => role.isSuperAdmin),
  };
}

// Fixed, deterministic dates so business-day math never depends on the day
// the suite happens to run. 2024-01-01 is a Monday.
const JOB_CREATED_AT = new Date("2024-01-01T00:00:00Z"); // Mon
const APPLICATION_CREATED_AT = new Date("2024-01-02T00:00:00Z"); // Tue
const OFFER_CREATED_AT = new Date("2024-01-04T00:00:00Z"); // Thu — 2 business days after the application (Wed, Thu)
const OFFER_APPROVED_AT = new Date("2024-01-05T00:00:00Z"); // Fri — 1 business day after the offer
const HANDOFF_CREATED_AT = new Date("2024-01-08T00:00:00Z"); // Mon (next week) — 5 business days after the job

describe("reports service", () => {
  let ownerRoleId: string;
  let restrictedRoleId: string;
  let noAccessRoleId: string;

  let ownerUser: SessionContext;
  let restrictedUser: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let sourceId: string;

  let jobId: string;
  let stageAppliedId: string;
  let stageScreeningId: string;
  let application1Id: string; // moved Applied -> Screening
  let application2Id: string; // still at Applied
  let offer1Id: string; // approved, extended in time

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [ownerRole, restrictedRole, noAccessRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: "Test Reports Owner",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "JOB", action: "READ", scope: "ALL" },
                { resource: "OFFER", action: "READ", scope: "ALL" },
              ],
            },
          },
        },
      }),
      prisma.role.create({
        data: {
          name: "Test Reports Restricted",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "JOB", action: "READ", scope: "OWN" },
                { resource: "OFFER", action: "READ", scope: "OWN" },
              ],
            },
          },
        },
      }),
      prisma.role.create({ data: { name: "Test Reports No Access" } }), // no grants, by design
    ]);
    ownerRoleId = ownerRole.id;
    restrictedRoleId = restrictedRole.id;
    noAccessRoleId = noAccessRole.id;

    const [ownerUserRow, restrictedUserRow, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Reports Owner", email: "reports-owner@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Reports Restricted", email: "reports-restricted@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Reports No Access", email: "reports-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: ownerUserRow.id, roleId: ownerRoleId },
        { userId: restrictedUserRow.id, roleId: restrictedRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    ownerUser = contextFor({ ...ownerUserRow, roles: [{ id: ownerRoleId, name: "Test Reports Owner", isSuperAdmin: false }] });
    restrictedUser = contextFor({
      ...restrictedUserRow,
      roles: [{ id: restrictedRoleId, name: "Test Reports Restricted", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Reports No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const source = await prisma.controlledList.create({
      data: { key: "CANDIDATE_SOURCE", label: "Sources", values: { create: { value: "referral", label: "Referral" } } },
    });
    sourceId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: source.id } })).id;

    const job = await prisma.job.create({
      data: {
        title: "Backend Engineer",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "MEDIUM",
        status: "OPEN",
        positionsCount: 2,
        primaryRecruiterId: ownerUser.userId,
        createdById: ownerUser.userId,
        createdAt: JOB_CREATED_AT,
      },
    });
    jobId = job.id;

    const [stageApplied, stageScreening] = await Promise.all([
      prisma.pipelineStage.create({ data: { jobId, name: "Applied", sortOrder: 0 } }),
      prisma.pipelineStage.create({ data: { jobId, name: "Screening", sortOrder: 1 } }),
      prisma.pipelineStage.create({ data: { jobId, name: "Offer", sortOrder: 2 } }),
    ]);
    stageAppliedId = stageApplied.id;
    stageScreeningId = stageScreening.id;

    const [candidate1, candidate2] = await Promise.all([
      prisma.candidate.create({
        data: {
          name: "Candidate One",
          phone: "+10000000001",
          consentGivenAt: new Date(),
          sourceId,
          createdById: ownerUser.userId,
        },
      }),
      prisma.candidate.create({
        data: { name: "Candidate Two", phone: "+10000000002", consentGivenAt: new Date(), createdById: ownerUser.userId },
      }),
    ]);

    const application1 = await prisma.application.create({
      data: {
        candidateId: candidate1.id,
        jobId,
        stageId: stageScreeningId,
        ownerId: ownerUser.userId,
        createdById: ownerUser.userId,
        createdAt: APPLICATION_CREATED_AT,
      },
    });
    application1Id = application1.id;

    const application2 = await prisma.application.create({
      data: {
        candidateId: candidate2.id,
        jobId,
        stageId: stageAppliedId,
        ownerId: ownerUser.userId,
        createdById: ownerUser.userId,
        createdAt: APPLICATION_CREATED_AT,
      },
    });
    application2Id = application2.id;

    // application1's only recorded move: Applied -> Screening. Its initial
    // stage (Applied) has no event of its own — nothing "moved it into"
    // Applied, it started there — which is exactly the gap the fromStageId
    // fix in getPipelineFunnelReport exists to cover.
    await prisma.applicationEvent.create({
      data: {
        applicationId: application1Id,
        type: "STAGE_CHANGE",
        fromStageId: stageAppliedId,
        toStageId: stageScreeningId,
        actorId: ownerUser.userId,
      },
    });

    await prisma.interview.create({
      data: {
        applicationId: application1Id,
        roundName: "Technical Round 1",
        mode: "VIRTUAL",
        scheduledAt: new Date("2024-01-10T00:00:00Z"),
        scheduledById: ownerUser.userId,
        createdAt: APPLICATION_CREATED_AT,
      },
    });

    const offer1 = await prisma.offer.create({
      data: {
        applicationId: application1Id,
        compensation: 95000,
        status: "ACCEPTED",
        createdById: ownerUser.userId,
        createdAt: OFFER_CREATED_AT,
      },
    });
    offer1Id = offer1.id;

    await prisma.offerApproval.create({
      data: {
        offerId: offer1Id,
        status: "APPROVED",
        approverId: ownerUser.userId,
        decidedAt: OFFER_APPROVED_AT,
        createdAt: OFFER_CREATED_AT,
      },
    });

    await prisma.handoffRecord.create({
      data: {
        offerId: offer1Id,
        applicationId: application1Id,
        status: "ACCEPTED",
        deliveryMethod: "STRUCTURED_EXPORT",
        payload: {},
        initiatedById: ownerUser.userId,
        createdAt: HANDOFF_CREATED_AT,
      },
    });

    // A second offer with no approval decision yet — exercises
    // pendingApprovalCount, distinct from the measured/compliant set.
    await prisma.offer.create({
      data: {
        applicationId: application2Id,
        compensation: 80000,
        status: "PENDING_APPROVAL",
        createdById: ownerUser.userId,
        createdAt: OFFER_CREATED_AT,
      },
    });
  });

  afterAll(async () => {
    await prisma.handoffRecord.deleteMany({});
    await prisma.offerApproval.deleteMany({});
    await prisma.offer.deleteMany({});
    await prisma.interview.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.candidate.deleteMany({ where: { phone: { in: ["+10000000001", "+10000000002"] } } });
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "CANDIDATE_SOURCE"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION", "CANDIDATE_SOURCE"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, restrictedRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["reports-owner@test.local", "reports-restricted@test.local", "reports-noaccess@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, restrictedRoleId, noAccessRoleId] } } });
  });

  describe("getPipelineFunnelReport", () => {
    it("reports current + cumulative-reached counts per stage, including an application's initial stage", async () => {
      const report = await getPipelineFunnelReport(ownerUser, { jobId });

      expect(report.totalApplications).toBe(2);
      const byName = Object.fromEntries(report.stages.map((stage) => [stage.name, stage]));

      expect(byName.Applied.currentCount).toBe(1); // application2 only
      expect(byName.Applied.reachedCount).toBe(2); // application1 (via fromStageId) + application2
      expect(byName.Applied.conversionFromPrevious).toBeNull();

      expect(byName.Screening.currentCount).toBe(1); // application1
      expect(byName.Screening.reachedCount).toBe(1);
      expect(byName.Screening.conversionFromPrevious).toBeCloseTo(0.5);

      expect(byName.Offer.currentCount).toBe(0);
      expect(byName.Offer.reachedCount).toBe(0);
      expect(byName.Offer.conversionFromPrevious).toBe(0);
    });

    it("throws NotFoundError for an unknown job id", async () => {
      await expect(getPipelineFunnelReport(ownerUser, { jobId: "nope" })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ForbiddenError when the job exists but is out of the caller's scope", async () => {
      await expect(getPipelineFunnelReport(restrictedUser, { jobId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ForbiddenError for a role with no JOB grant at all", async () => {
      await expect(getPipelineFunnelReport(noAccessUser, { jobId })).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("getTimeToFillOfferReport", () => {
    it("computes business-day averages for time-to-fill and time-to-offer", async () => {
      const report = await getTimeToFillOfferReport(ownerUser, {});

      expect(report.jobs).toHaveLength(1);
      const [row] = report.jobs;
      expect(row.jobId).toBe(jobId);
      expect(row.hiresCount).toBe(1);
      expect(row.timeToFillDaysAvg).toBe(5); // Jan 1 (Mon) -> Jan 8 (Mon)
      expect(row.offersCount).toBe(2); // both applications got an offer
      // application1: Jan 2 -> Jan 4 = 2 business days. application2: Jan 2 -> Jan 4 = 2 as well (offer2 shares OFFER_CREATED_AT).
      expect(row.timeToOfferDaysAvg).toBe(2);

      expect(report.overall.hiresCount).toBe(1);
      expect(report.overall.timeToFillDaysAvg).toBe(5);
    });

    it("returns an empty result (not an error) when scope excludes every job", async () => {
      const report = await getTimeToFillOfferReport(restrictedUser, {});
      expect(report.jobs).toEqual([]);
      expect(report.overall).toEqual({ timeToFillDaysAvg: null, hiresCount: 0, timeToOfferDaysAvg: null, offersCount: 0 });
    });
  });

  describe("getRecruiterProductivityReport", () => {
    it("counts workload/productivity metrics for the ALL-scope owner", async () => {
      const report = await getRecruiterProductivityReport(ownerUser, { recruiterId: ownerUser.userId });
      expect(report.rows).toHaveLength(1);
      const [row] = report.rows;
      expect(row.openJobsCount).toBe(1);
      expect(row.activeApplicationsCount).toBe(2);
      expect(row.interviewsScheduledCount).toBe(1);
      expect(row.offersExtendedCount).toBe(1); // only offer1 (ACCEPTED) counts — offer2 is PENDING_APPROVAL
      expect(row.hiresCount).toBe(1);
    });

    it("excludes activity outside a supplied date range", async () => {
      const report = await getRecruiterProductivityReport(ownerUser, {
        recruiterId: ownerUser.userId,
        dateFrom: new Date("2024-02-01T00:00:00Z"),
      });
      const [row] = report.rows;
      expect(row.interviewsScheduledCount).toBe(0);
      expect(row.offersExtendedCount).toBe(0);
      expect(row.hiresCount).toBe(0);
      // Snapshot counts (workload, not date-ranged activity) stay unaffected by the date filter.
      expect(row.openJobsCount).toBe(1);
      expect(row.activeApplicationsCount).toBe(2);
    });

    it("an OWN-scope caller can only request their own recruiterId", async () => {
      await expect(getRecruiterProductivityReport(restrictedUser, { recruiterId: ownerUser.userId })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      const own = await getRecruiterProductivityReport(restrictedUser, {});
      expect(own.rows).toHaveLength(1);
      expect(own.rows[0].recruiter.id).toBe(restrictedUser.userId);
      expect(own.rows[0].openJobsCount).toBe(0);
    });
  });

  describe("getOfferTatComplianceReport", () => {
    it("measures submission-to-approval TAT and separates pending-approval offers", async () => {
      const report = await getOfferTatComplianceReport(ownerUser, { tatThresholdDays: 3 });

      expect(report.measuredCount).toBe(1); // only offer1 has a decided approval
      expect(report.pendingApprovalCount).toBe(1); // offer2
      expect(report.rows[0].offerId).toBe(offer1Id);
      expect(report.rows[0].tatDays).toBe(1); // Jan 4 (Thu) -> Jan 5 (Fri)
      expect(report.rows[0].compliant).toBe(true);
      expect(report.compliantCount).toBe(1);
      expect(report.complianceRate).toBe(1);
      expect(report.avgTatDays).toBe(1);
    });

    it("marks an offer non-compliant once its TAT exceeds a stricter threshold", async () => {
      const report = await getOfferTatComplianceReport(ownerUser, { tatThresholdDays: 0 });
      expect(report.rows[0].compliant).toBe(false);
      expect(report.complianceRate).toBe(0);
    });

    it("scopes offers to the caller's own grant", async () => {
      const report = await getOfferTatComplianceReport(restrictedUser, { tatThresholdDays: 3 });
      expect(report.measuredCount).toBe(0);
      expect(report.pendingApprovalCount).toBe(0);
      expect(report.rows).toEqual([]);
    });

    it("throws ForbiddenError for a role with no OFFER grant", async () => {
      await expect(getOfferTatComplianceReport(noAccessUser, { tatThresholdDays: 3 })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("falls back to Organization.offerTatThresholdDays when the caller omits tatThresholdDays", async () => {
      // The test DB is migration-only (no prisma/seed.ts run — see
      // tests/setup/global-setup.ts), so there is normally no Organization
      // row at all here; create/restore around this one test rather than
      // assuming either state.
      const existing = await prisma.organization.findFirst();
      const orgId = existing?.id ?? (await prisma.organization.create({ data: { name: "Test Org" } })).id;
      const originalThreshold = existing?.offerTatThresholdDays ?? 3;

      try {
        await prisma.organization.update({ where: { id: orgId }, data: { offerTatThresholdDays: 0 } });
        const report = await getOfferTatComplianceReport(ownerUser, {});
        expect(report.tatThresholdDays).toBe(0);
        expect(report.rows[0].compliant).toBe(false);

        // An explicit request-level override still wins over the org default.
        const overridden = await getOfferTatComplianceReport(ownerUser, { tatThresholdDays: 30 });
        expect(overridden.tatThresholdDays).toBe(30);
        expect(overridden.rows[0].compliant).toBe(true);
      } finally {
        if (existing) {
          await prisma.organization.update({ where: { id: orgId }, data: { offerTatThresholdDays: originalThreshold } });
        } else {
          await prisma.organization.delete({ where: { id: orgId } });
        }
      }
    });
  });
});
