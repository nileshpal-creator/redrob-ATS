import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createJobPosting,
  listJobPostings,
  receiveInboundApplication,
  removeJobPosting,
} from "@/lib/services/job-postings";
import { createCandidate } from "@/lib/services/candidates";
import { createJob, transitionJobStatus } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";

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

describe("JobPostingService", () => {
  let recruiterRoleId: string;
  let otherRecruiterRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let otherRecruiter: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let linkedInSourceId: string;
  let indeedSourceId: string;

  let openJobId: string;
  let draftJobId: string;

  const jobInput = (overrides: Partial<JobCreateInput> = {}): JobCreateInput =>
    ({
      title: "Backend Engineer",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 5,
      description: "A great backend role.",
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      ...overrides,
    }) as JobCreateInput;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test JobPosting Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "OWN" },
              { resource: "JOB", action: "APPROVE", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const otherRecruiterRole = await prisma.role.create({
      data: {
        name: "Test JobPosting Other Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    otherRecruiterRoleId = otherRecruiterRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test JobPosting No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, otherRecruiterUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "JobPosting Recruiter", email: "jp-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "JobPosting Other", email: "jp-other@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "JobPosting No Access", email: "jp-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: otherRecruiterUser.id, roleId: otherRecruiterRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test JobPosting Recruiter", isSuperAdmin: false }] });
    otherRecruiter = contextFor({
      ...otherRecruiterUser,
      roles: [{ id: otherRecruiterRoleId, name: "Test JobPosting Other Recruiter", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test JobPosting No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const sourceList = await prisma.controlledList.create({
      data: {
        key: "CANDIDATE_SOURCE",
        label: "Candidate Sources",
        values: { createMany: { data: [{ value: "linkedin", label: "LinkedIn" }, { value: "indeed", label: "Indeed" }] } },
      },
    });
    linkedInSourceId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: sourceList.id, value: "linkedin" } })).id;
    indeedSourceId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: sourceList.id, value: "indeed" } })).id;

    const openJob = await createJob(recruiter, jobInput());
    const submitted = await transitionJobStatus(recruiter, openJob.id, { action: "SUBMIT", version: openJob.version });
    await transitionJobStatus(recruiter, openJob.id, { action: "APPROVE", version: submitted.version });
    openJobId = openJob.id;

    const draftJob = await createJob(recruiter, jobInput({ title: "Draft Role" }));
    draftJobId = draftJob.id;
  });

  afterAll(async () => {
    await prisma.candidateNote.deleteMany({ where: { candidate: { createdById: recruiter.userId } } });
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.jobPosting.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({ where: { createdById: recruiter.userId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "CANDIDATE_SOURCE"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION", "CANDIDATE_SOURCE"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [recruiterRoleId, otherRecruiterRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["jp-recruiter@test.local", "jp-other@test.local", "jp-noaccess@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, otherRecruiterRoleId, noAccessRoleId] } } });
  });

  describe("createJobPosting", () => {
    it("posts an OPEN job to a board via the mock provider", async () => {
      const posting = await createJobPosting(recruiter, openJobId, { sourceId: linkedInSourceId });
      expect(posting.status).toBe("POSTED");
      expect(posting.externalPostingId).toMatch(/^mock-/);
      expect(posting.source.label).toBe("LinkedIn");

      const audit = await prisma.auditLog.findMany({ where: { entityType: "JOB", entityId: openJobId, action: "job_posting.created" } });
      expect(audit).toHaveLength(1);
    });

    it("rejects posting a non-OPEN (DRAFT) job", async () => {
      await expect(createJobPosting(recruiter, draftJobId, { sourceId: linkedInSourceId })).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an invalid/inactive source id", async () => {
      await expect(createJobPosting(recruiter, openJobId, { sourceId: "nope" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects re-posting to a board the job is already POSTED to", async () => {
      await expect(createJobPosting(recruiter, openJobId, { sourceId: linkedInSourceId })).rejects.toBeInstanceOf(ValidationError);
    });

    it("re-activates the same row (not a new one) when re-posting after a removal", async () => {
      const removed = await prisma.jobPosting.findFirstOrThrow({ where: { jobId: openJobId, sourceId: linkedInSourceId } });
      await removeJobPosting(recruiter, removed.id);

      const reposted = await createJobPosting(recruiter, openJobId, { sourceId: linkedInSourceId });
      expect(reposted.id).toBe(removed.id);
      expect(reposted.status).toBe("POSTED");

      const rows = await prisma.jobPosting.findMany({ where: { jobId: openJobId, sourceId: linkedInSourceId } });
      expect(rows).toHaveLength(1);
    });

    it("lets only one of two concurrent re-posts to the same already-REMOVED (job, board) succeed", async () => {
      const repostJob = await createJob(recruiter, jobInput({ title: "Repost Race Role" }));
      const repostSubmitted = await transitionJobStatus(recruiter, repostJob.id, { action: "SUBMIT", version: repostJob.version });
      await transitionJobStatus(recruiter, repostJob.id, { action: "APPROVE", version: repostSubmitted.version });

      const first = await createJobPosting(recruiter, repostJob.id, { sourceId: indeedSourceId });
      await removeJobPosting(recruiter, first.id);

      const results = await Promise.allSettled([
        createJobPosting(recruiter, repostJob.id, { sourceId: indeedSourceId }),
        createJobPosting(recruiter, repostJob.id, { sourceId: indeedSourceId }),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Whichever request loses the race is rejected either way: by the initial
      // "already posted" guard if it reads after the winner's write landed, or by
      // the status-guarded update (ConflictError) if both read stale state first —
      // timing-dependent, but never a silent lost update either way.
      const loserReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(loserReason).toBeInstanceOf(Error);
      expect(loserReason instanceof ConflictError || loserReason instanceof ValidationError).toBe(true);

      const rows = await prisma.jobPosting.findMany({ where: { jobId: repostJob.id, sourceId: indeedSourceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("POSTED");
    });

    it("records a FAILED posting (not a thrown error) when the mock provider rejects a jobless description", async () => {
      const noDescJob = await createJob(recruiter, jobInput({ title: "No Description Role", description: undefined }));
      const noDescSubmitted = await transitionJobStatus(recruiter, noDescJob.id, { action: "SUBMIT", version: noDescJob.version });
      await transitionJobStatus(recruiter, noDescJob.id, { action: "APPROVE", version: noDescSubmitted.version });

      const posting = await createJobPosting(recruiter, noDescJob.id, { sourceId: indeedSourceId });
      expect(posting.status).toBe("FAILED");
      expect(posting.errorMessage).toMatch(/description/i);
    });

    it("blocks a user with no JOB:UPDATE authority over this job", async () => {
      await expect(createJobPosting(otherRecruiter, openJobId, { sourceId: indeedSourceId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("blocks a user with no JOB grants at all", async () => {
      await expect(createJobPosting(noAccessUser, openJobId, { sourceId: indeedSourceId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError for an unknown job id", async () => {
      await expect(createJobPosting(recruiter, "nope", { sourceId: indeedSourceId })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("lets only one of two concurrent first-time posts to the same (job, board) succeed", async () => {
      const raceJob = await createJob(recruiter, jobInput({ title: "Race Role" }));
      const raceSubmitted = await transitionJobStatus(recruiter, raceJob.id, { action: "SUBMIT", version: raceJob.version });
      await transitionJobStatus(recruiter, raceJob.id, { action: "APPROVE", version: raceSubmitted.version });

      const results = await Promise.allSettled([
        createJobPosting(recruiter, raceJob.id, { sourceId: indeedSourceId }),
        createJobPosting(recruiter, raceJob.id, { sourceId: indeedSourceId }),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rows = await prisma.jobPosting.findMany({ where: { jobId: raceJob.id, sourceId: indeedSourceId } });
      expect(rows).toHaveLength(1);
    });
  });

  describe("listJobPostings", () => {
    it("lists postings for a job a user can READ", async () => {
      const postings = await listJobPostings(recruiter, openJobId);
      expect(postings.length).toBeGreaterThan(0);
    });

    it("throws NotFoundError for an unknown job id", async () => {
      await expect(listJobPostings(recruiter, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("removeJobPosting", () => {
    it("rejects removing a posting that is not currently POSTED", async () => {
      const alreadyRemoved = await prisma.jobPosting.findFirstOrThrow({
        where: { jobId: openJobId, sourceId: linkedInSourceId, status: "POSTED" },
      });
      await removeJobPosting(recruiter, alreadyRemoved.id);

      await expect(removeJobPosting(recruiter, alreadyRemoved.id)).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws NotFoundError for an unknown posting id", async () => {
      await expect(removeJobPosting(recruiter, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("blocks a user with no JOB:UPDATE authority over this job", async () => {
      const posting = await createJobPosting(recruiter, openJobId, { sourceId: linkedInSourceId });
      await expect(removeJobPosting(otherRecruiter, posting.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("lets only one of two concurrent removals of the same POSTED posting succeed", async () => {
      const posting = await prisma.jobPosting.findFirstOrThrow({ where: { jobId: openJobId, status: "POSTED" } });

      const results = await Promise.allSettled([removeJobPosting(recruiter, posting.id), removeJobPosting(recruiter, posting.id)]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });
  });

  describe("receiveInboundApplication", () => {
    async function postedTo(sourceId: string, jobId = openJobId) {
      const existing = await prisma.jobPosting.findUnique({ where: { jobId_sourceId: { jobId, sourceId } } });
      if (existing?.status === "POSTED") return existing;
      return createJobPosting(recruiter, jobId, { sourceId });
    }

    it("creates a new candidate tagged with the posting's board and an application in the job's pipeline", async () => {
      const posting = await postedTo(linkedInSourceId);

      const application = await receiveInboundApplication(recruiter, posting.id, {
        name: "Inbound Candidate",
        phone: "+1 555-7001",
        note: "Looks strong",
      });

      expect(application.jobId).toBe(openJobId);
      expect(application.sourcedFromPostingId).toBe(posting.id);

      const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: application.candidateId } });
      expect(candidate.sourceId).toBe(linkedInSourceId);

      const notes = await prisma.candidateNote.findMany({ where: { candidateId: candidate.id } });
      expect(notes.some((note) => note.body.includes("Looks strong"))).toBe(true);

      const audit = await prisma.auditLog.findMany({
        where: { entityType: "APPLICATION", entityId: application.id, action: "job_posting.inbound_application_received" },
      });
      expect(audit).toHaveLength(1);
    });

    it("reuses an existing candidate by phone match without overwriting their original source", async () => {
      const original = await createCandidate(recruiter, {
        name: "Returning Candidate",
        phone: "+1 555-7002",
        sourceId: indeedSourceId,
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);

      const posting = await postedTo(linkedInSourceId);
      const application = await receiveInboundApplication(recruiter, posting.id, {
        name: "Returning Candidate",
        phone: "+1 555-7002",
      });

      expect(application.candidateId).toBe(original.id);

      const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: original.id } });
      expect(candidate.sourceId).toBe(indeedSourceId);
    });

    it("rejects inbound applications against a posting that is not currently POSTED", async () => {
      const activePosting = await postedTo(linkedInSourceId);
      await removeJobPosting(recruiter, activePosting.id);

      await expect(
        receiveInboundApplication(recruiter, activePosting.id, { name: "X", phone: "+1 555-7003" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws NotFoundError for an unknown posting id", async () => {
      await expect(receiveInboundApplication(recruiter, "nope", { name: "X", phone: "+1 555-7004" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});
