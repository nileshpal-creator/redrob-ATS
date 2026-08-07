import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { acknowledgeHandoff, getHandoff, listHandoffs, retryHandoff } from "@/lib/services/handoffs";
import { createOffer, transitionOffer } from "@/lib/services/offers";
import { createApplication, transitionApplication } from "@/lib/services/applications";
import { scheduleInterview } from "@/lib/services/interviews";
import { createCandidate, getCandidateTimeline, updateCandidate } from "@/lib/services/candidates";
import { createJob } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput, CandidateUpdateInput } from "@/lib/validations/candidate";
import type { OfferCreateInput } from "@/lib/validations/offer";
import type { InterviewCreateInput } from "@/lib/validations/interview";

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

describe("HandoffService", () => {
  let recruiterRoleId: string;
  let hiringManagerRoleId: string;
  let hrOnboardingRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let hiringManager: SessionContext;
  let hrOnboarding: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;

  let jobId: string;

  const jobInput = (overrides: Partial<JobCreateInput> = {}): JobCreateInput =>
    ({
      title: "Backend Engineer",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 5,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      ...overrides,
    }) as JobCreateInput;

  /** Candidate with an email delivers cleanly; without one, delivery fails deterministically. */
  async function candidateWithEmail(phone: string) {
    return createCandidate(recruiter, {
      name: "Handoff Candidate",
      phone,
      email: "candidate@example.com",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
  }

  async function candidateWithoutEmail(phone: string) {
    return createCandidate(recruiter, {
      name: "Emailless Candidate",
      phone,
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
  }

  /** Walks a fresh offer through DRAFT -> ... -> ACCEPTED, returning the resulting handoff row. */
  async function acceptOfferFor(applicationId: string, compensation = 90000) {
    const offer = await createOffer(recruiter, { applicationId, compensation } as OfferCreateInput);
    const submitted = await transitionOffer(recruiter, offer.id, { action: "SUBMIT", version: 0 });
    const approved = await transitionOffer(hiringManager, offer.id, { action: "APPROVE", version: submitted.version });
    const extended = await transitionOffer(recruiter, offer.id, { action: "EXTEND", version: approved.version });
    await transitionOffer(recruiter, offer.id, { action: "ACCEPT", version: extended.version });

    const handoff = await prisma.handoffRecord.findUniqueOrThrow({ where: { offerId: offer.id } });
    return { offer, handoff };
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Handoff Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "UPDATE", scope: "ALL" },
              { resource: "INTERVIEW", action: "CREATE", scope: "ALL" },
              { resource: "OFFER", action: "CREATE", scope: "ALL" },
              { resource: "OFFER", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "UPDATE", scope: "OWN" },
              { resource: "HANDOFF", action: "READ", scope: "ALL" },
              { resource: "HANDOFF", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test Handoff Hiring Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "OFFER", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "APPROVE", scope: "ALL" },
              { resource: "HANDOFF", action: "READ", scope: "ALL" },
            ],
          },
        },
      },
    });
    hiringManagerRoleId = hiringManagerRole.id;

    const hrOnboardingRole = await prisma.role.create({
      data: {
        name: "Test Handoff HR Onboarding",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "HANDOFF", action: "READ", scope: "ALL" },
              { resource: "HANDOFF", action: "APPROVE", scope: "ALL" },
            ],
          },
        },
      },
    });
    hrOnboardingRoleId = hrOnboardingRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Handoff No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, hiringManagerUser, hrOnboardingUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Handoff Recruiter", email: "ho-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Handoff HM", email: "ho-hm@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Handoff HR Onboarding", email: "ho-hr@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Handoff No Access", email: "ho-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: hiringManagerUser.id, roleId: hiringManagerRoleId },
        { userId: hrOnboardingUser.id, roleId: hrOnboardingRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Handoff Recruiter", isSuperAdmin: false }] });
    hiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: hiringManagerRoleId, name: "Test Handoff Hiring Manager", isSuperAdmin: false }],
    });
    hrOnboarding = contextFor({
      ...hrOnboardingUser,
      roles: [{ id: hrOnboardingRoleId, name: "Test Handoff HR Onboarding", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Handoff No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const job = await createJob(recruiter, jobInput());
    jobId = job.id;
  });

  afterAll(async () => {
    await prisma.handoffDeliveryAttempt.deleteMany({});
    await prisma.handoffRecord.deleteMany({});
    await prisma.offerApproval.deleteMany({});
    await prisma.offer.deleteMany({});
    await prisma.interview.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: [recruiterRoleId, hiringManagerRoleId, hrOnboardingRoleId, noAccessRoleId] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: ["ho-recruiter@test.local", "ho-hm@test.local", "ho-hr@test.local", "ho-noaccess@test.local"] } },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [recruiterRoleId, hiringManagerRoleId, hrOnboardingRoleId, noAccessRoleId] } },
    });
  });

  describe("createHandoffForOffer (via Offer ACCEPT)", () => {
    it("creates a DELIVERED handoff with a candidate/offer/job snapshot when delivery succeeds", async () => {
      const candidate = await candidateWithEmail("+1 555-0930");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });

      const { offer, handoff } = await acceptOfferFor(application.id, 91000);

      expect(handoff.status).toBe("DELIVERED");
      expect(handoff.deliveryMethod).toBe("STRUCTURED_EXPORT");
      expect(handoff.initiatedById).toBe(recruiter.userId);
      expect(handoff.exceptionReason).toBeNull();
      expect(handoff.version).toBe(0);

      const payload = handoff.payload as unknown as {
        candidate: { id: string; email: string | null };
        offer: { id: string; compensation: string };
        job: { id: string };
      };
      expect(payload.candidate.id).toBe(candidate.id);
      expect(payload.candidate.email).toBe("candidate@example.com");
      expect(payload.offer.id).toBe(offer.id);
      expect(payload.offer.compensation).toBe("91000");
      expect(payload.job.id).toBe(jobId);

      const attempts = await prisma.handoffDeliveryAttempt.findMany({ where: { handoffRecordId: handoff.id } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].succeeded).toBe(true);
    });

    it("creates an EXCEPTION handoff when the candidate has no email, recording the failure reason", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0931");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });

      const { handoff } = await acceptOfferFor(application.id);

      expect(handoff.status).toBe("EXCEPTION");
      expect(handoff.exceptionReason).toMatch(/email/i);

      const attempts = await prisma.handoffDeliveryAttempt.findMany({ where: { handoffRecordId: handoff.id } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].succeeded).toBe(false);
      expect(attempts[0].errorMessage).toMatch(/email/i);
    });

    it("writes exactly one HANDOFF_INITIATED audit entry alongside OFFER_STATUS_CHANGED", async () => {
      const candidate = await candidateWithEmail("+1 555-0932");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });

      const { handoff } = await acceptOfferFor(application.id);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "HANDOFF", entityId: handoff.id },
        select: { action: true },
      });
      expect(entries.map((entry) => entry.action)).toEqual(["handoff.initiated"]);
    });

    it("freezes the payload at creation — later candidate edits don't change it", async () => {
      const candidate = await candidateWithEmail("+1 555-0933");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });

      const { handoff } = await acceptOfferFor(application.id);

      await updateCandidate(recruiter, candidate.id, { version: candidate.version, name: "Renamed After Handoff" });

      const payload = handoff.payload as unknown as { candidate: { name: string } };
      expect(payload.candidate.name).toBe("Handoff Candidate");
    });
  });

  describe("getHandoff / listHandoffs access", () => {
    it("lets the initiator, Hiring Manager (ALL), and HR/Onboarding (ALL) all read the handoff", async () => {
      const candidate = await candidateWithEmail("+1 555-0934");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await expect(getHandoff(recruiter, handoff.id)).resolves.toMatchObject({ id: handoff.id });
      await expect(getHandoff(hiringManager, handoff.id)).resolves.toMatchObject({ id: handoff.id });
      await expect(getHandoff(hrOnboarding, handoff.id)).resolves.toMatchObject({ id: handoff.id });
    });

    it("blocks a user with no HANDOFF:READ grant", async () => {
      const candidate = await candidateWithEmail("+1 555-0935");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await expect(getHandoff(noAccessUser, handoff.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError for an unknown handoff id", async () => {
      await expect(getHandoff(recruiter, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("denies listHandoffs entirely for a role with no HANDOFF:READ grant", async () => {
      const noReadRole = await prisma.role.create({ data: { name: "Test Handoff No Read" } });
      const noReadUserRow = await prisma.user.create({
        data: { name: "No Read", email: "ho-noread@test.local", passwordHash: await bcrypt.hash("Test123!Test123!", 4) },
      });
      await prisma.userRole.create({ data: { userId: noReadUserRow.id, roleId: noReadRole.id } });
      const noReadUser = contextFor({ ...noReadUserRow, roles: [{ id: noReadRole.id, name: "Test Handoff No Read", isSuperAdmin: false }] });

      await expect(listHandoffs(noReadUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.userRole.deleteMany({ where: { roleId: noReadRole.id } });
      await prisma.user.delete({ where: { id: noReadUserRow.id } });
      await prisma.role.delete({ where: { id: noReadRole.id } });
    });
  });

  describe("retryHandoff", () => {
    it("blocks retrying a handoff that is not in EXCEPTION status", async () => {
      const candidate = await candidateWithEmail("+1 555-0936");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);
      expect(handoff.status).toBe("DELIVERED");

      await expect(retryHandoff(recruiter, handoff.id, { version: handoff.version })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("re-pushes the frozen payload — retrying an EXCEPTION handoff with a still-missing email stays EXCEPTION", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0937");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);
      expect(handoff.status).toBe("EXCEPTION");

      // Fixing the live candidate record must not matter — retry re-pushes
      // the frozen payload snapshot, not a fresh read of the candidate.
      await updateCandidate(recruiter, candidate.id, {
        version: candidate.version,
        email: "fixed@example.com",
      } as CandidateUpdateInput);

      const retried = await retryHandoff(recruiter, handoff.id, { version: handoff.version });
      expect(retried.status).toBe("EXCEPTION");
      expect(retried.version).toBe(handoff.version + 1);

      const attempts = await prisma.handoffDeliveryAttempt.findMany({ where: { handoffRecordId: handoff.id } });
      expect(attempts).toHaveLength(2);
    });

    it("rejects a stale version with ConflictError", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0938");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await expect(retryHandoff(recruiter, handoff.id, { version: 99 })).rejects.toBeInstanceOf(ConflictError);
    });

    it("blocks a user without HANDOFF:UPDATE authority over this handoff", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0939");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await expect(retryHandoff(hrOnboarding, handoff.id, { version: handoff.version })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("throws NotFoundError for an unknown handoff id", async () => {
      await expect(retryHandoff(recruiter, "nope", { version: 0 })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("lets only one of two concurrent retries on the same EXCEPTION handoff succeed", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0940");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      const results = await Promise.allSettled([
        retryHandoff(recruiter, handoff.id, { version: handoff.version }),
        retryHandoff(recruiter, handoff.id, { version: handoff.version }),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });
  });

  describe("acknowledgeHandoff concurrency", () => {
    it("lets only one of two concurrent acknowledgements of the same DELIVERED handoff succeed", async () => {
      const candidate = await candidateWithEmail("+1 555-09401");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);
      expect(handoff.status).toBe("DELIVERED");

      const results = await Promise.allSettled([
        acknowledgeHandoff(hrOnboarding, handoff.id, { version: handoff.version, outcome: "ACCEPTED" }),
        acknowledgeHandoff(hrOnboarding, handoff.id, { version: handoff.version, outcome: "ACCEPTED" }),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });
  });

  describe("acknowledgeHandoff", () => {
    it("blocks acknowledging a handoff that is not DELIVERED", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0941");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);
      expect(handoff.status).toBe("EXCEPTION");

      await expect(
        acknowledgeHandoff(hrOnboarding, handoff.id, { version: handoff.version, outcome: "ACCEPTED" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("HR/Onboarding acknowledges a DELIVERED handoff as ACCEPTED", async () => {
      const candidate = await candidateWithEmail("+1 555-0942");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      const acknowledged = await acknowledgeHandoff(hrOnboarding, handoff.id, {
        version: handoff.version,
        outcome: "ACCEPTED",
      });

      expect(acknowledged.status).toBe("ACCEPTED");
      expect(acknowledged.acknowledgedById).toBe(hrOnboarding.userId);
      expect(acknowledged.acknowledgedAt).not.toBeNull();

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "HANDOFF", entityId: handoff.id, action: "handoff.status_changed" },
      });
      expect(entries).toHaveLength(1);
    });

    it("HR/Onboarding reports an EXCEPTION on a DELIVERED handoff with a reason", async () => {
      const candidate = await candidateWithEmail("+1 555-0943");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      const acknowledged = await acknowledgeHandoff(hrOnboarding, handoff.id, {
        version: handoff.version,
        outcome: "EXCEPTION",
        exceptionReason: "Signed agreement missing from the package.",
      });

      expect(acknowledged.status).toBe("EXCEPTION");
      expect(acknowledged.exceptionReason).toBe("Signed agreement missing from the package.");
    });

    it("blocks a Recruiter without HANDOFF:APPROVE from acknowledging", async () => {
      const candidate = await candidateWithEmail("+1 555-0944");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await expect(
        acknowledgeHandoff(recruiter, handoff.id, { version: handoff.version, outcome: "ACCEPTED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects a stale version with ConflictError", async () => {
      const candidate = await candidateWithEmail("+1 555-0945");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await expect(
        acknowledgeHandoff(hrOnboarding, handoff.id, { version: 99, outcome: "ACCEPTED" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws NotFoundError for an unknown handoff id", async () => {
      await expect(
        acknowledgeHandoff(hrOnboarding, "nope", { version: 0, outcome: "ACCEPTED" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("read-only / archive behavior", () => {
    it("blocks stage transitions, new interviews, and new offers once a handoff is ACCEPTED", async () => {
      const candidate = await candidateWithEmail("+1 555-0946");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await acknowledgeHandoff(hrOnboarding, handoff.id, { version: handoff.version, outcome: "ACCEPTED" });

      const reasonList = await prisma.controlledList.create({
        data: { key: "REJECTION_REASON", label: "Rejection Reasons", values: { create: { value: "r", label: "R" } } },
      });
      const reasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: reasonList.id } })).id;

      await expect(
        transitionApplication(recruiter, application.id, { action: "REJECT", version: 0, reasonId }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        scheduleInterview(recruiter, {
          applicationId: application.id,
          roundName: "Post-hire check-in",
          mode: "VIRTUAL",
          scheduledAt: new Date("2026-09-01T10:00:00Z"),
          panelistUserIds: [recruiter.userId],
        } as InterviewCreateInput),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        createOffer(recruiter, { applicationId: application.id, compensation: 50000 } as OfferCreateInput),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.controlledListValue.deleteMany({ where: { listId: reasonList.id } });
      await prisma.controlledList.delete({ where: { id: reasonList.id } });
    });

    it("does not block those actions while the handoff is merely DELIVERED (not yet ACCEPTED)", async () => {
      const candidate = await candidateWithEmail("+1 555-0947");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);
      expect(handoff.status).toBe("DELIVERED");

      const interview = await scheduleInterview(recruiter, {
        applicationId: application.id,
        roundName: "Post-hire check-in",
        mode: "VIRTUAL",
        scheduledAt: new Date("2026-09-01T10:00:00Z"),
        panelistUserIds: [recruiter.userId],
      } as InterviewCreateInput);
      expect(interview.applicationId).toBe(application.id);
    });
  });

  describe("candidate timeline integration", () => {
    it("surfaces handoff_initiated, handoff_delivered, and handoff_accepted items", async () => {
      const candidate = await candidateWithEmail("+1 555-0948");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);
      await acknowledgeHandoff(hrOnboarding, handoff.id, { version: handoff.version, outcome: "ACCEPTED" });

      const timeline = await getCandidateTimeline(recruiter, candidate.id);

      expect(timeline.items.some((item) => item.type === "handoff_initiated")).toBe(true);
      expect(timeline.items.some((item) => item.type === "handoff_delivered")).toBe(true);
      expect(timeline.items.some((item) => item.type === "handoff_accepted")).toBe(true);
    });

    it("surfaces a handoff_exception item for a failed delivery attempt", async () => {
      const candidate = await candidateWithoutEmail("+1 555-0949");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      await acceptOfferFor(application.id);

      const timeline = await getCandidateTimeline(recruiter, candidate.id);
      expect(timeline.items.some((item) => item.type === "handoff_exception")).toBe(true);
    });
  });

  describe("database integrity", () => {
    it("cascades HandoffDeliveryAttempt deletion when a HandoffRecord row is removed", async () => {
      const candidate = await candidateWithEmail("+1 555-0950");
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
      const { handoff } = await acceptOfferFor(application.id);

      await prisma.handoffRecord.delete({ where: { id: handoff.id } });

      const attempts = await prisma.handoffDeliveryAttempt.findMany({ where: { handoffRecordId: handoff.id } });
      expect(attempts).toHaveLength(0);
    });
  });
});
