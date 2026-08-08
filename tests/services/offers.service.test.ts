import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createOffer,
  getOffer,
  listOffers,
  transitionOffer,
  updateOffer,
} from "@/lib/services/offers";
import { runDueOfferExpirations } from "@/lib/services/offer-expiry";
import { createApplication, transitionApplication } from "@/lib/services/applications";
import { createCandidate, getCandidateTimeline } from "@/lib/services/candidates";
import { createJob } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";
import type { OfferCreateInput } from "@/lib/validations/offer";

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

describe("OfferService", () => {
  let recruiterRoleId: string;
  let hiringManagerRoleId: string;
  let recruitingManagerRoleId: string;
  let hrOnboardingRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let hiringManager: SessionContext;
  let recruitingManager: SessionContext;
  let teamMemberRecruiter: SessionContext;
  let hrOnboarding: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let outcomeReasonId: string;
  let wrongListReasonId: string;

  let jobId: string;
  let candidateId: string;
  let applicationId: string;

  const jobInput = (overrides: Partial<JobCreateInput> = {}): JobCreateInput =>
    ({
      title: "Backend Engineer",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 2,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      ...overrides,
    }) as JobCreateInput;

  const offerInput = (overrides: Partial<OfferCreateInput> = {}): OfferCreateInput =>
    ({
      applicationId,
      compensation: 95000,
      ...overrides,
    }) as OfferCreateInput;

  // Walks a fresh DRAFT offer to EXTENDED — the only status LAPSED is ever
  // reachable from — reusing the exact SUBMIT -> APPROVE -> EXTEND sequence
  // the lifecycle test above already exercises.
  async function extendOffer(respondByDate?: Date) {
    const offer = await createOffer(recruiter, offerInput());
    const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });
    const approved = await transitionOffer(hiringManager, offer.id, { action: "APPROVE", version: submitted.version });
    return transitionOffer(recruiter, offer.id, {
      action: "EXTEND",
      version: approved.version,
      ...(respondByDate && { respondByDate }),
    });
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Offer Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "UPDATE", scope: "ALL" },
              { resource: "OFFER", action: "CREATE", scope: "ALL" },
              { resource: "OFFER", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test Offer Hiring Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "OFFER", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "APPROVE", scope: "ALL" },
            ],
          },
        },
      },
    });
    hiringManagerRoleId = hiringManagerRole.id;

    const recruitingManagerRole = await prisma.role.create({
      data: {
        name: "Test Offer Recruiting Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "OFFER", action: "CREATE", scope: "ALL" },
              { resource: "OFFER", action: "READ", scope: "TEAM" },
              { resource: "OFFER", action: "UPDATE", scope: "TEAM" },
            ],
          },
        },
      },
    });
    recruitingManagerRoleId = recruitingManagerRole.id;

    const hrOnboardingRole = await prisma.role.create({
      data: {
        name: "Test Offer HR Onboarding",
        rolePermissions: { createMany: { data: [{ resource: "OFFER", action: "READ", scope: "ALL" }] } },
      },
    });
    hrOnboardingRoleId = hrOnboardingRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Offer No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, hiringManagerUser, recruitingManagerUser, hrOnboardingUser, noAccessUserRow] =
      await Promise.all([
        prisma.user.create({ data: { name: "Offer Recruiter", email: "of-recruiter@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Offer HM", email: "of-hm@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Offer Recruiting Manager", email: "of-rm@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Offer HR Onboarding", email: "of-hr@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Offer No Access", email: "of-noaccess@test.local", passwordHash } }),
      ]);

    const teamMemberUser = await prisma.user.create({
      data: {
        name: "Offer Team Member Recruiter",
        email: "of-teammember@test.local",
        passwordHash,
        managerId: recruitingManagerUser.id,
      },
    });

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: hiringManagerUser.id, roleId: hiringManagerRoleId },
        { userId: recruitingManagerUser.id, roleId: recruitingManagerRoleId },
        { userId: teamMemberUser.id, roleId: recruiterRoleId },
        { userId: hrOnboardingUser.id, roleId: hrOnboardingRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Offer Recruiter", isSuperAdmin: false }] });
    hiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: hiringManagerRoleId, name: "Test Offer Hiring Manager", isSuperAdmin: false }],
    });
    recruitingManager = contextFor({
      ...recruitingManagerUser,
      roles: [{ id: recruitingManagerRoleId, name: "Test Offer Recruiting Manager", isSuperAdmin: false }],
    });
    teamMemberRecruiter = contextFor({
      ...teamMemberUser,
      roles: [{ id: recruiterRoleId, name: "Test Offer Recruiter", isSuperAdmin: false }],
    });
    hrOnboarding = contextFor({
      ...hrOnboardingUser,
      roles: [{ id: hrOnboardingRoleId, name: "Test Offer HR Onboarding", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Offer No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const outcomeList = await prisma.controlledList.create({
      data: {
        key: "OFFER_OUTCOME_REASON",
        label: "Offer Outcome Reasons",
        values: { create: { value: "comp-mismatch", label: "Compensation mismatch" } },
      },
    });
    outcomeReasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: outcomeList.id } })).id;
    // A value from the wrong list — proves the reason is checked against
    // OFFER_OUTCOME_REASON specifically, not just "any active value".
    wrongListReasonId = departmentId;

    const job = await createJob(recruiter, jobInput());
    jobId = job.id;

    const candidate = await createCandidate(recruiter, {
      name: "Jane Applicant",
      phone: "+1 555-0920",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
    candidateId = candidate.id;

    const application = await createApplication(recruiter, { candidateId, jobId });
    applicationId = application.id;
  });

  afterAll(async () => {
    // Module 7: an ACCEPTed offer (see "walks DRAFT -> ... -> ACCEPTED"
    // below) gets a HandoffRecord, and HandoffRecord.offerId has no cascade
    // — it must be cleared before the Offer row it points at.
    await prisma.handoffDeliveryAttempt.deleteMany({});
    await prisma.handoffRecord.deleteMany({});
    await prisma.offerApproval.deleteMany({});
    await prisma.offer.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "OFFER_OUTCOME_REASON"] } } },
    });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION", "OFFER_OUTCOME_REASON"] } } });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: [recruiterRoleId, hiringManagerRoleId, recruitingManagerRoleId, hrOnboardingRoleId, noAccessRoleId] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            "of-recruiter@test.local",
            "of-hm@test.local",
            "of-rm@test.local",
            "of-teammember@test.local",
            "of-hr@test.local",
            "of-noaccess@test.local",
          ],
        },
      },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [recruiterRoleId, hiringManagerRoleId, recruitingManagerRoleId, hrOnboardingRoleId, noAccessRoleId] } },
    });
  });

  describe("createOffer", () => {
    it("creates a draft offer owned by the creator", async () => {
      const offer = await createOffer(recruiter, offerInput());

      expect(offer.status).toBe("DRAFT");
      expect(offer.compensation.toString()).toBe("95000");
      expect(offer.createdBy.id).toBe(recruiter.userId);
      expect(offer.version).toBe(0);
      expect(offer.approvals).toHaveLength(0);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("accepts designation and location, and lets them be edited while still DRAFT", async () => {
      const offer = await createOffer(recruiter, offerInput({ designation: "Senior Engineer", location: "Remote" }));
      expect(offer.designation).toBe("Senior Engineer");
      expect(offer.location).toBe("Remote");

      const updated = await updateOffer(recruiter, offer.id, {
        version: offer.version,
        designation: "Staff Engineer",
        location: "Bengaluru, India",
      });
      expect(updated.designation).toBe("Staff Engineer");
      expect(updated.location).toBe("Bengaluru, India");

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("leaves designation/location null when omitted", async () => {
      const offer = await createOffer(recruiter, offerInput());
      expect(offer.designation).toBeNull();
      expect(offer.location).toBeNull();

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("rejects creating from a user without OFFER:CREATE", async () => {
      await expect(createOffer(hiringManager, offerInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createOffer(noAccessUser, offerInput())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects an unknown application", async () => {
      await expect(createOffer(recruiter, offerInput({ applicationId: "nope" }))).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects a second active offer for the same application", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(createOffer(recruiter, offerInput())).rejects.toBeInstanceOf(ValidationError);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("lets only one of two concurrent creates for the same application succeed", async () => {
      // The findFirst pre-check above is a courtesy message, not the real
      // guard — two requests can both pass it before either writes. This
      // proves the offer_one_active_per_application partial unique index
      // (and the P2002 -> ValidationError conversion in createOffer) is
      // what actually prevents the race, not just the pre-check.
      const results = await Promise.allSettled([createOffer(recruiter, offerInput()), createOffer(recruiter, offerInput())]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError);

      const survivor = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createOffer>>>).value;
      await prisma.offer.delete({ where: { id: survivor.id } });
    });

    it("rejects creating on an application that is no longer active", async () => {
      const candidate = await createCandidate(recruiter, {
        name: "Terminal Applicant",
        phone: "+1 555-0921",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const reasonList = await prisma.controlledList.create({
        data: { key: "REJECTION_REASON", label: "Rejection Reasons", values: { create: { value: "r", label: "R" } } },
      });
      const reasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: reasonList.id } })).id;

      await transitionApplication(recruiter, application.id, { action: "WITHDRAW", version: 0, reasonId });

      await expect(createOffer(recruiter, offerInput({ applicationId: application.id }))).rejects.toBeInstanceOf(
        ValidationError,
      );

      await prisma.application.delete({ where: { id: application.id } });
      await prisma.candidate.delete({ where: { id: candidate.id } });
      await prisma.controlledListValue.deleteMany({ where: { listId: reasonList.id } });
      await prisma.controlledList.delete({ where: { id: reasonList.id } });
    });
  });

  describe("getOffer / listOffers access", () => {
    it("lets the creator, Hiring Manager (ALL), and HR/Onboarding (ALL) all read the offer", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(getOffer(recruiter, offer.id)).resolves.toMatchObject({ id: offer.id });
      await expect(getOffer(hiringManager, offer.id)).resolves.toMatchObject({ id: offer.id });
      await expect(getOffer(hrOnboarding, offer.id)).resolves.toMatchObject({ id: offer.id });

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("blocks a user with no OFFER:READ grant", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(getOffer(noAccessUser, offer.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("throws NotFoundError for an unknown offer id", async () => {
      await expect(getOffer(recruiter, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("denies listOffers entirely for a role with no OFFER:READ grant", async () => {
      await expect(listOffers(noAccessUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("scopes listOffers to a Recruiting Manager's team, not everyone's", async () => {
      // Offers allow at most one active offer per application, so this
      // needs its own second application — not two offers on the shared
      // fixture applicationId.
      const otherCandidate = await createCandidate(recruiter, {
        name: "Scope Test Applicant",
        phone: "+1 555-0925",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const otherApplication = await createApplication(recruiter, { candidateId: otherCandidate.id, jobId });

      const mine = await createOffer(teamMemberRecruiter, offerInput());
      const notMine = await createOffer(recruiter, offerInput({ applicationId: otherApplication.id }));

      const result = await listOffers(recruitingManager, { page: 1, pageSize: 25 });
      const ids = result.offers.map((offer) => offer.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(notMine.id);

      await prisma.offer.deleteMany({ where: { id: { in: [mine.id, notMine.id] } } });
      await prisma.application.delete({ where: { id: otherApplication.id } });
      await prisma.candidate.delete({ where: { id: otherCandidate.id } });
    });
  });

  describe("updateOffer", () => {
    it("lets the creator edit a draft offer", async () => {
      const offer = await createOffer(recruiter, offerInput());

      const updated = await updateOffer(recruiter, offer.id, { version: 0, compensation: 105000 });

      expect(updated.compensation.toString()).toBe("105000");
      expect(updated.version).toBe(1);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("rejects a stale version with ConflictError", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(updateOffer(recruiter, offer.id, { version: 99, compensation: 1 })).rejects.toBeInstanceOf(
        ConflictError,
      );

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("blocks editing once the offer is no longer a draft", async () => {
      const offer = await createOffer(recruiter, offerInput());
      await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });

      await expect(updateOffer(recruiter, offer.id, { version: 1, compensation: 1 })).rejects.toBeInstanceOf(
        ValidationError,
      );

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("blocks a user without OFFER:UPDATE authority over this offer", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(updateOffer(hrOnboarding, offer.id, { version: 0, compensation: 1 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await prisma.offer.delete({ where: { id: offer.id } });
    });
  });

  describe("transitionOffer lifecycle", () => {
    it("walks DRAFT -> PENDING_APPROVAL -> APPROVED -> EXTENDED -> ACCEPTED, incrementing Job.positionsFilledCount", async () => {
      const jobBefore = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

      const offer = await createOffer(recruiter, offerInput());
      const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });
      expect(submitted.status).toBe("PENDING_APPROVAL");
      expect(submitted.approvals).toHaveLength(1);
      expect(submitted.approvals[0].status).toBe("PENDING");
      expect(submitted.approvals[0].approverId).toBeNull();

      const approved = await transitionOffer(hiringManager, offer.id, {
        action: "APPROVE",
        version: submitted.version,
        comments: "Compensation is within band.",
      });
      expect(approved.status).toBe("APPROVED");
      expect(approved.approvals[0].status).toBe("APPROVED");
      expect(approved.approvals[0].approver?.id).toBe(hiringManager.userId);
      expect(approved.approvals[0].comments).toBe("Compensation is within band.");
      expect(approved.approvals[0].decidedAt).not.toBeNull();

      const extended = await transitionOffer(recruiter, offer.id, { action: "EXTEND", version: approved.version });
      expect(extended.status).toBe("EXTENDED");

      const accepted = await transitionOffer(recruiter, offer.id, { action: "ACCEPT", version: extended.version });
      expect(accepted.status).toBe("ACCEPTED");

      const jobAfter = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      expect(jobAfter.positionsFilledCount).toBe(jobBefore.positionsFilledCount + 1);
      // Accepting an offer is a derived counter update, not a user-facing
      // Job edit — it must not bump Job.version and create spurious
      // optimistic-lock conflicts for anyone editing the Job concurrently.
      expect(jobAfter.version).toBe(jobBefore.version);

      // §11.7: ACCEPT also triggers Module 7's onboarding handoff — see
      // tests/services/handoffs.service.test.ts for full coverage of that
      // behavior; this just confirms the trigger fires.
      const handoff = await prisma.handoffRecord.findUnique({ where: { offerId: offer.id } });
      expect(handoff).not.toBeNull();

      await prisma.handoffDeliveryAttempt.deleteMany({ where: { handoffRecordId: handoff!.id } });
      await prisma.handoffRecord.delete({ where: { id: handoff!.id } });
      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("REJECT sends a pending offer back to DRAFT and preserves the rejected approval row on resubmit", async () => {
      const offer = await createOffer(recruiter, offerInput());
      const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });

      const rejected = await transitionOffer(hiringManager, offer.id, {
        action: "REJECT",
        version: submitted.version,
        comments: "Compensation exceeds band, please revise.",
      });
      expect(rejected.status).toBe("DRAFT");
      expect(rejected.approvals).toHaveLength(1);
      expect(rejected.approvals[0].status).toBe("REJECTED");

      const resubmitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: rejected.version });
      expect(resubmitted.approvals).toHaveLength(2);
      expect(resubmitted.approvals.map((approval) => approval.status).sort()).toEqual(["PENDING", "REJECTED"]);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("blocks a Recruiter without OFFER:APPROVE from approving or rejecting", async () => {
      const offer = await createOffer(recruiter, offerInput());
      const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });

      await expect(
        transitionOffer(recruiter, offer.id, { action: "APPROVE", version: submitted.version }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("rejects an illegal transition for the current status", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(
        transitionOffer(recruiter, offer.id, { action: "ACCEPT", version: 0 }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("rejects a stale version with ConflictError", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(
        transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 99 }),
      ).rejects.toBeInstanceOf(ConflictError);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("DECLINE requires a valid OFFER_OUTCOME_REASON value and records it", async () => {
      const offer = await createOffer(recruiter, offerInput());
      const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });
      const approved = await transitionOffer(hiringManager, offer.id, { action: "APPROVE", version: submitted.version });
      const extended = await transitionOffer(recruiter, offer.id, { action: "EXTEND", version: approved.version });

      await expect(
        transitionOffer(recruiter, offer.id, { action: "DECLINE", version: extended.version, reasonId: wrongListReasonId }),
      ).rejects.toBeInstanceOf(ValidationError);

      const declined = await transitionOffer(recruiter, offer.id, {
        action: "DECLINE",
        version: extended.version,
        reasonId: outcomeReasonId,
      });
      expect(declined.status).toBe("DECLINED");
      expect(declined.outcomeReason?.id).toBe(outcomeReasonId);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("REVOKE is available from any non-terminal status and a Recruiting Manager can revoke a team member's offer", async () => {
      const offer = await createOffer(teamMemberRecruiter, offerInput());

      const revoked = await transitionOffer(recruitingManager, offer.id, {
        action: "REVOKE",
        version: 0,
        reasonId: outcomeReasonId,
      });
      expect(revoked.status).toBe("REVOKED");
      expect(revoked.outcomeReason?.id).toBe(outcomeReasonId);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("blocks a Recruiting Manager from revoking an offer outside their team", async () => {
      const offer = await createOffer(recruiter, offerInput());

      await expect(
        transitionOffer(recruitingManager, offer.id, { action: "REVOKE", version: 0, reasonId: outcomeReasonId }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("EXTEND accepts an optional respondByDate", async () => {
      const respondByDate = new Date("2026-12-01T00:00:00Z");
      const extended = await extendOffer(respondByDate);
      expect(extended.respondByDate?.toISOString()).toBe(respondByDate.toISOString());

      await prisma.offer.delete({ where: { id: extended.id } });
    });

    it("EXTEND without a respondByDate leaves it null — the offer never auto-lapses", async () => {
      const extended = await extendOffer();
      expect(extended.respondByDate).toBeNull();

      await prisma.offer.delete({ where: { id: extended.id } });
    });

    it("ignores a respondByDate passed on a non-EXTEND action (rejected upstream by offerTransitionSchema — see tests/validations/offer.test.ts)", async () => {
      const offer = await createOffer(recruiter, offerInput());

      const submitted = await transitionOffer(recruiter, offer.id, {
        action: "SUBMIT",
        version: 0,
        respondByDate: new Date("2026-12-01T00:00:00Z"),
      });
      expect(submitted.respondByDate).toBeNull();

      await prisma.offer.delete({ where: { id: offer.id } });
    });
  });

  describe("runDueOfferExpirations (auto-expiry)", () => {
    it("lapses an EXTENDED offer once its respondByDate has passed", async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const extended = await extendOffer(past);

      const result = await runDueOfferExpirations(new Date());
      expect(result.lapsedCount).toBeGreaterThanOrEqual(1);

      const offer = await getOffer(recruiter, extended.id);
      expect(offer.status).toBe("LAPSED");
      expect(offer.version).toBe(extended.version + 1);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { entityType: "OFFER", entityId: extended.id, action: "offer.lapsed" },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorId).toBeNull();

      await prisma.offer.delete({ where: { id: extended.id } });
    });

    it("does not lapse an EXTENDED offer whose respondByDate is still in the future", async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const extended = await extendOffer(future);

      await runDueOfferExpirations(new Date());

      const offer = await getOffer(recruiter, extended.id);
      expect(offer.status).toBe("EXTENDED");

      await prisma.offer.delete({ where: { id: extended.id } });
    });

    it("never lapses an EXTENDED offer with no respondByDate set", async () => {
      const extended = await extendOffer();

      await runDueOfferExpirations(new Date());

      const offer = await getOffer(recruiter, extended.id);
      expect(offer.status).toBe("EXTENDED");

      await prisma.offer.delete({ where: { id: extended.id } });
    });

    it("does not touch a non-EXTENDED offer, even one with a past respondByDate lingering from a prior EXTEND", async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const extended = await extendOffer(past);
      const accepted = await transitionOffer(recruiter, extended.id, { action: "ACCEPT", version: extended.version });

      await runDueOfferExpirations(new Date());

      const offer = await getOffer(recruiter, accepted.id);
      expect(offer.status).toBe("ACCEPTED");

      const handoff = await prisma.handoffRecord.findUnique({ where: { offerId: accepted.id } });
      await prisma.handoffDeliveryAttempt.deleteMany({ where: { handoffRecordId: handoff!.id } });
      await prisma.handoffRecord.delete({ where: { id: handoff!.id } });
      await prisma.offer.delete({ where: { id: accepted.id } });
    });

    it("is idempotent under concurrent/overlapping runs — only one lapses each due offer, via the version-guarded updateMany", async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const extended = await extendOffer(past);

      const [first, second] = await Promise.all([
        runDueOfferExpirations(new Date()),
        runDueOfferExpirations(new Date()),
      ]);
      // Exactly one of the two overlapping runs claims this offer — the total
      // across both calls is 1, not 2, and never 0.
      expect(first.lapsedCount + second.lapsedCount).toBe(1);

      const offer = await getOffer(recruiter, extended.id);
      expect(offer.status).toBe("LAPSED");
      expect(offer.version).toBe(extended.version + 1);

      const auditEntries = await prisma.auditLog.findMany({
        where: { entityType: "OFFER", entityId: extended.id, action: "offer.lapsed" },
      });
      expect(auditEntries).toHaveLength(1);

      await prisma.offer.delete({ where: { id: extended.id } });
    });

    it("a LAPSED offer has no legal further transitions", async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const extended = await extendOffer(past);
      await runDueOfferExpirations(new Date());
      const lapsed = await getOffer(recruiter, extended.id);
      expect(lapsed.status).toBe("LAPSED");

      await expect(
        transitionOffer(recruiter, extended.id, { action: "REVOKE", version: lapsed.version, reasonId: outcomeReasonId }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.offer.delete({ where: { id: extended.id } });
    });
  });

  describe("candidate timeline integration", () => {
    it("surfaces created, approved, extended, and accepted items on the candidate timeline", async () => {
      const candidate = await createCandidate(recruiter, {
        name: "Timeline Offer Applicant",
        phone: "+1 555-0922",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });

      const offer = await createOffer(recruiter, offerInput({ applicationId: application.id, compensation: 88000 }));
      const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });
      const approved = await transitionOffer(hiringManager, offer.id, { action: "APPROVE", version: submitted.version });
      await transitionOffer(recruiter, offer.id, { action: "EXTEND", version: approved.version });

      const timeline = await getCandidateTimeline(recruiter, candidate.id);

      const createdItem = timeline.items.find((item) => item.type === "offer_created");
      expect(createdItem).toBeDefined();
      if (createdItem?.type === "offer_created") {
        expect(createdItem.compensation).toBe("88000");
      }

      const approvedItem = timeline.items.find((item) => item.type === "offer_approved");
      expect(approvedItem).toBeDefined();
      if (approvedItem?.type === "offer_approved") {
        expect(approvedItem.approver?.id).toBe(hiringManager.userId);
      }

      const extendedItem = timeline.items.find((item) => item.type === "offer_extended");
      expect(extendedItem).toBeDefined();

      await prisma.offer.delete({ where: { id: offer.id } });
      await prisma.application.delete({ where: { id: application.id } });
      await prisma.candidate.delete({ where: { id: candidate.id } });
    });

    it("does not include another candidate's offers", async () => {
      const candidateA = await createCandidate(recruiter, {
        name: "Offer Candidate A",
        phone: "+1 555-0923",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const candidateB = await createCandidate(recruiter, {
        name: "Offer Candidate B",
        phone: "+1 555-0924",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const applicationA = await createApplication(recruiter, { candidateId: candidateA.id, jobId });
      const applicationB = await createApplication(recruiter, { candidateId: candidateB.id, jobId });

      const offerB = await createOffer(recruiter, offerInput({ applicationId: applicationB.id }));

      const timelineA = await getCandidateTimeline(recruiter, candidateA.id);
      expect(timelineA.items.filter((item) => item.type.startsWith("offer_"))).toHaveLength(0);

      await prisma.offer.delete({ where: { id: offerB.id } });
      await prisma.application.deleteMany({ where: { id: { in: [applicationA.id, applicationB.id] } } });
      await prisma.candidate.deleteMany({ where: { id: { in: [candidateA.id, candidateB.id] } } });
    });
  });

  describe("database integrity", () => {
    it("writes an AuditLog entry for create, update, and every status transition", async () => {
      const offer = await createOffer(recruiter, offerInput());
      await updateOffer(recruiter, offer.id, { version: 0, compensation: 96000 });
      const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 1 });
      const approved = await transitionOffer(hiringManager, offer.id, { action: "APPROVE", version: submitted.version });
      expect(approved.status).toBe("APPROVED");

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "OFFER", entityId: offer.id },
        select: { action: true },
      });
      const actions = entries.map((entry) => entry.action);
      expect(actions.filter((action) => action === "offer.created")).toHaveLength(1);
      expect(actions.filter((action) => action === "offer.updated")).toHaveLength(1);
      expect(actions.filter((action) => action === "offer.status_changed")).toHaveLength(2);

      await prisma.offer.delete({ where: { id: offer.id } });
    });

    it("cascades OfferApproval deletion when an Offer row is removed", async () => {
      const offer = await createOffer(recruiter, offerInput());
      await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });

      await prisma.offer.delete({ where: { id: offer.id } });

      const approvals = await prisma.offerApproval.findMany({ where: { offerId: offer.id } });
      expect(approvals).toHaveLength(0);
    });
  });
});
