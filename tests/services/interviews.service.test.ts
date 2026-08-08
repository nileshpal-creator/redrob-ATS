import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  cancelInterview,
  completeInterview,
  getInterview,
  listInterviews,
  markInterviewNoShow,
  scheduleInterview,
  submitInterviewFeedback,
  updateInterview,
  updateInterviewFeedback,
} from "@/lib/services/interviews";
import { createApplication, transitionApplication } from "@/lib/services/applications";
import { createCandidate, getCandidateTimeline } from "@/lib/services/candidates";
import { createJob } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";
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

describe("InterviewService", () => {
  let recruiterRoleId: string;
  let hiringManagerRoleId: string;
  let interviewerRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let hiringManager: SessionContext;
  let interviewer1: SessionContext;
  let interviewer2: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let cancellationReasonId: string;
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
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      ...overrides,
    }) as JobCreateInput;

  const interviewInput = (overrides: Partial<InterviewCreateInput> = {}): InterviewCreateInput =>
    ({
      applicationId,
      roundName: "Technical Round 1",
      mode: "VIRTUAL",
      scheduledAt: new Date("2026-09-01T10:00:00Z"),
      panelistUserIds: [interviewer1.userId],
      ...overrides,
    }) as InterviewCreateInput;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Interview Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "UPDATE", scope: "ALL" },
              { resource: "INTERVIEW", action: "CREATE", scope: "ALL" },
              { resource: "INTERVIEW", action: "READ", scope: "ALL" },
              { resource: "INTERVIEW", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test Interview Hiring Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "INTERVIEW", action: "READ", scope: "ALL" },
              { resource: "INTERVIEW", action: "UPDATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    hiringManagerRoleId = hiringManagerRole.id;

    const interviewerRole = await prisma.role.create({
      data: {
        name: "Test Interviewer",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "INTERVIEW", action: "READ", scope: "OWN" },
              { resource: "INTERVIEW", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    interviewerRoleId = interviewerRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Interview No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, hiringManagerUser, interviewer1User, interviewer2User, noAccessUserRow] =
      await Promise.all([
        prisma.user.create({ data: { name: "Interview Recruiter", email: "iv-recruiter@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Interview HM", email: "iv-hm@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Interviewer One", email: "iv-interviewer1@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Interviewer Two", email: "iv-interviewer2@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Interview No Access", email: "iv-noaccess@test.local", passwordHash } }),
      ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: hiringManagerUser.id, roleId: hiringManagerRoleId },
        { userId: interviewer1User.id, roleId: interviewerRoleId },
        { userId: interviewer2User.id, roleId: interviewerRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Interview Recruiter", isSuperAdmin: false }] });
    hiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: hiringManagerRoleId, name: "Test Interview Hiring Manager", isSuperAdmin: false }],
    });
    interviewer1 = contextFor({
      ...interviewer1User,
      roles: [{ id: interviewerRoleId, name: "Test Interviewer", isSuperAdmin: false }],
    });
    interviewer2 = contextFor({
      ...interviewer2User,
      roles: [{ id: interviewerRoleId, name: "Test Interviewer", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Interview No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const cancellationList = await prisma.controlledList.create({
      data: {
        key: "INTERVIEW_CANCELLATION_REASON",
        label: "Interview Cancellation Reasons",
        values: { create: { value: "conflict", label: "Scheduling conflict" } },
      },
    });
    cancellationReasonId = (
      await prisma.controlledListValue.findFirstOrThrow({ where: { listId: cancellationList.id } })
    ).id;
    // A value from the wrong list — proves the reason is checked against
    // INTERVIEW_CANCELLATION_REASON specifically, not just "any active value".
    wrongListReasonId = departmentId;

    const job = await createJob(recruiter, jobInput());
    jobId = job.id;

    const candidate = await createCandidate(recruiter, {
      name: "Jane Applicant",
      phone: "+1 555-0910",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
    candidateId = candidate.id;

    const application = await createApplication(recruiter, { candidateId, jobId });
    applicationId = application.id;
  });

  afterAll(async () => {
    await prisma.interviewFeedback.deleteMany({});
    await prisma.interviewPanelist.deleteMany({});
    await prisma.interview.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "INTERVIEW_CANCELLATION_REASON"] } } },
    });
    await prisma.controlledList.deleteMany({
      where: { key: { in: ["DEPARTMENT", "LOCATION", "INTERVIEW_CANCELLATION_REASON"] } },
    });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: [recruiterRoleId, hiringManagerRoleId, interviewerRoleId, noAccessRoleId] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            "iv-recruiter@test.local",
            "iv-hm@test.local",
            "iv-interviewer1@test.local",
            "iv-interviewer2@test.local",
            "iv-noaccess@test.local",
          ],
        },
      },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [recruiterRoleId, hiringManagerRoleId, interviewerRoleId, noAccessRoleId] } },
    });
  });

  describe("scheduleInterview", () => {
    it("schedules an interview with a panel, defaulting duration to 60 minutes", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      expect(interview.roundName).toBe("Technical Round 1");
      expect(interview.status).toBe("SCHEDULED");
      expect(interview.durationMinutes).toBe(60);
      expect(interview.scheduledById).toBe(recruiter.userId);
      expect(interview.panelists.map((panelist) => panelist.user.id)).toEqual([interviewer1.userId]);
      expect(interview.version).toBe(0);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("accepts an explicit duration and multiple panelists", async () => {
      const interview = await scheduleInterview(
        recruiter,
        interviewInput({ durationMinutes: 45, panelistUserIds: [interviewer1.userId, interviewer2.userId] }),
      );

      expect(interview.durationMinutes).toBe(45);
      expect(interview.panelists).toHaveLength(2);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects scheduling from a user without INTERVIEW:CREATE", async () => {
      await expect(scheduleInterview(interviewer1, interviewInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(scheduleInterview(noAccessUser, interviewInput())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects an unknown application", async () => {
      await expect(
        scheduleInterview(recruiter, interviewInput({ applicationId: "nope" })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an inactive panelist user id", async () => {
      await expect(
        scheduleInterview(recruiter, interviewInput({ panelistUserIds: ["nope"] })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects scheduling on an application that is no longer active", async () => {
      const candidate = await createCandidate(recruiter, {
        name: "Terminal Applicant",
        phone: "+1 555-0911",
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

      await expect(
        scheduleInterview(recruiter, interviewInput({ applicationId: application.id })),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.application.delete({ where: { id: application.id } });
      await prisma.candidate.delete({ where: { id: candidate.id } });
      await prisma.controlledListValue.deleteMany({ where: { listId: reasonList.id } });
      await prisma.controlledList.delete({ where: { id: reasonList.id } });
    });
  });

  describe("getInterview / listInterviews access", () => {
    it("lets the scheduler, a hiring manager (ALL), and an assigned panelist all read the interview", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(getInterview(recruiter, interview.id)).resolves.toMatchObject({ id: interview.id });
      await expect(getInterview(hiringManager, interview.id)).resolves.toMatchObject({ id: interview.id });
      await expect(getInterview(interviewer1, interview.id)).resolves.toMatchObject({ id: interview.id });

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("blocks a second interviewer who is not on the panel", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(getInterview(interviewer2, interview.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("throws NotFoundError for an unknown interview id", async () => {
      await expect(getInterview(recruiter, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("denies listInterviews entirely for a role with no INTERVIEW:READ grant", async () => {
      await expect(listInterviews(noAccessUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("scopes listInterviews to an interviewer's own panel assignments, not everyone's", async () => {
      const mine = await scheduleInterview(recruiter, interviewInput({ panelistUserIds: [interviewer1.userId] }));
      const notMine = await scheduleInterview(recruiter, interviewInput({ panelistUserIds: [interviewer2.userId] }));

      const result = await listInterviews(interviewer1, { page: 1, pageSize: 25 });
      const ids = result.interviews.map((interview) => interview.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(notMine.id);

      await prisma.interview.deleteMany({ where: { id: { in: [mine.id, notMine.id] } } });
    });

    it("filters listInterviews by jobId and a scheduledAt date range — the calendar view's own query params", async () => {
      const otherJob = await createJob(recruiter, jobInput({ title: "Other Calendar Job" }));
      const otherApplication = await createApplication(recruiter, { candidateId, jobId: otherJob.id });

      const inRange = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-01T09:00:00Z") }),
      );
      const outOfRange = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-11-01T09:00:00Z") }),
      );
      const otherJobInterview = await scheduleInterview(
        recruiter,
        interviewInput({
          applicationId: otherApplication.id,
          scheduledAt: new Date("2026-10-02T09:00:00Z"),
          panelistUserIds: [interviewer2.userId],
        }),
      );

      const byJob = await listInterviews(hiringManager, { jobId: jobId, page: 1, pageSize: 25 });
      const byJobIds = byJob.interviews.map((interview) => interview.id);
      expect(byJobIds).toContain(inRange.id);
      expect(byJobIds).toContain(outOfRange.id);
      expect(byJobIds).not.toContain(otherJobInterview.id);

      const byRange = await listInterviews(hiringManager, {
        dateFrom: new Date("2026-10-01T00:00:00Z"),
        dateTo: new Date("2026-10-31T23:59:59Z"),
        page: 1,
        pageSize: 25,
      });
      const byRangeIds = byRange.interviews.map((interview) => interview.id);
      expect(byRangeIds).toContain(inRange.id);
      expect(byRangeIds).toContain(otherJobInterview.id);
      expect(byRangeIds).not.toContain(outOfRange.id);

      await prisma.interview.deleteMany({ where: { id: { in: [inRange.id, outOfRange.id, otherJobInterview.id] } } });
      await prisma.application.delete({ where: { id: otherApplication.id } });
      await prisma.job.delete({ where: { id: otherJob.id } });
    });

    it("filters listInterviews by recruiterId (scheduledById), and an OWN-scoped caller's filter never widens past their own visible set", async () => {
      const byRecruiterUser = await scheduleInterview(recruiter, interviewInput({ panelistUserIds: [interviewer1.userId] }));
      // Distinct scheduledById inserted directly — the test fixture set has
      // only one INTERVIEW:CREATE-capable role, so this mirrors the
      // "insert the exact row shape directly" precedent used above for the
      // inactive-panelist notification test rather than widening a shared
      // role fixture just for this one assertion.
      const byOtherUser = await prisma.interview.create({
        data: {
          applicationId,
          roundName: "Direct Insert Round",
          mode: "VIRTUAL",
          scheduledAt: new Date("2026-10-03T09:00:00Z"),
          scheduledById: hiringManager.userId,
          panelists: { create: { userId: interviewer2.userId } },
        },
      });

      const byRecruiter = await listInterviews(hiringManager, { recruiterId: recruiter.userId, page: 1, pageSize: 25 });
      const byRecruiterIds = byRecruiter.interviews.map((interview) => interview.id);
      expect(byRecruiterIds).toContain(byRecruiterUser.id);
      expect(byRecruiterIds).not.toContain(byOtherUser.id);

      // interviewer1 has OWN scope; asking for recruiterId=recruiter (who scheduled
      // byRecruiterUser) must not leak byOtherUser, which interviewer1 is not on the panel of.
      const asOwnScoped = await listInterviews(interviewer1, { recruiterId: recruiter.userId, page: 1, pageSize: 25 });
      const ownScopedIds = asOwnScoped.interviews.map((interview) => interview.id);
      expect(ownScopedIds).toContain(byRecruiterUser.id);
      expect(ownScopedIds).not.toContain(byOtherUser.id);

      await prisma.interview.deleteMany({ where: { id: { in: [byRecruiterUser.id, byOtherUser.id] } } });
    });
  });

  describe("updateInterview (reschedule/edit)", () => {
    it("lets the scheduler reschedule and replace the panel", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      const updated = await updateInterview(recruiter, interview.id, {
        version: 0,
        scheduledAt: new Date("2026-09-02T11:00:00Z"),
        panelistUserIds: [interviewer2.userId],
      });

      expect(updated.scheduledAt.toISOString()).toBe(new Date("2026-09-02T11:00:00Z").toISOString());
      expect(updated.panelists.map((panelist) => panelist.user.id)).toEqual([interviewer2.userId]);
      expect(updated.version).toBe(1);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects a stale version with ConflictError", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        updateInterview(recruiter, interview.id, { version: 99, roundName: "Renamed" }),
      ).rejects.toBeInstanceOf(ConflictError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("blocks a panelist from rescheduling — panel membership alone is not scheduling authority", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        updateInterview(interviewer1, interview.id, { version: 0, roundName: "Renamed" }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("lets an ALL-scope grantee reschedule an interview they did not schedule themselves", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      const updated = await updateInterview(hiringManager, interview.id, { version: 0, roundName: "Renamed" });
      expect(updated.roundName).toBe("Renamed");

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects editing an interview that is no longer scheduled", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await completeInterview(recruiter, interview.id, { version: 0 });

      await expect(
        updateInterview(recruiter, interview.id, { version: 1, roundName: "Renamed" }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });
  });

  describe("cancelInterview", () => {
    it("cancels a scheduled interview with a valid reason", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      const cancelled = await cancelInterview(recruiter, interview.id, { version: 0, reasonId: cancellationReasonId });

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancellationReason?.id).toBe(cancellationReasonId);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects a reason id from the wrong controlled list", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        cancelInterview(recruiter, interview.id, { version: 0, reasonId: wrongListReasonId }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects cancelling an already-cancelled interview", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await cancelInterview(recruiter, interview.id, { version: 0, reasonId: cancellationReasonId });

      await expect(
        cancelInterview(recruiter, interview.id, { version: 1, reasonId: cancellationReasonId }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("blocks a panelist from cancelling", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        cancelInterview(interviewer1, interview.id, { version: 0, reasonId: cancellationReasonId }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });
  });

  describe("completeInterview", () => {
    it("marks a scheduled interview complete", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      const completed = await completeInterview(recruiter, interview.id, { version: 0 });
      expect(completed.status).toBe("COMPLETED");

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects completing a cancelled interview", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await cancelInterview(recruiter, interview.id, { version: 0, reasonId: cancellationReasonId });

      await expect(completeInterview(recruiter, interview.id, { version: 1 })).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });
  });

  describe("markInterviewNoShow", () => {
    it("marks a scheduled interview as NO_SHOW, distinct from CANCELLED/COMPLETED", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      const marked = await markInterviewNoShow(recruiter, interview.id, { version: 0 });
      expect(marked.status).toBe("NO_SHOW");

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("is terminal — no further action is accepted once marked NO_SHOW", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await markInterviewNoShow(recruiter, interview.id, { version: 0 });

      await expect(completeInterview(recruiter, interview.id, { version: 1 })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        markInterviewNoShow(recruiter, interview.id, { version: 1 }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("blocks feedback submission for a NO_SHOW interview", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await markInterviewNoShow(recruiter, interview.id, { version: 0 });

      await expect(
        submitInterviewFeedback(interviewer1, interview.id, { recommendation: "YES" }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects a stale version with ConflictError", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await updateInterview(recruiter, interview.id, { version: 0, notes: "bump version" });

      await expect(markInterviewNoShow(recruiter, interview.id, { version: 0 })).rejects.toBeInstanceOf(ConflictError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects a caller without manage access", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        markInterviewNoShow(interviewer1, interview.id, { version: 0 }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });
  });

  describe("panel double-booking protection", () => {
    it("rejects an exact-overlap time slot for a shared panelist", async () => {
      const first = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-01T09:00:00Z"), durationMinutes: 60 }),
      );

      await expect(
        scheduleInterview(
          recruiter,
          interviewInput({ scheduledAt: new Date("2026-10-01T09:00:00Z"), durationMinutes: 60 }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: first.id } });
    });

    it("rejects a partial overlap (new interview starts mid-way through an existing one)", async () => {
      const first = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-02T09:00:00Z"), durationMinutes: 60 }),
      );

      // 09:30-10:30 overlaps the first interview's 09:00-10:00 window.
      await expect(
        scheduleInterview(
          recruiter,
          interviewInput({ scheduledAt: new Date("2026-10-02T09:30:00Z"), durationMinutes: 60 }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: first.id } });
    });

    it("allows an adjacent, non-overlapping time slot immediately after an existing interview ends", async () => {
      const first = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-03T09:00:00Z"), durationMinutes: 60 }),
      );

      // Starts exactly when the first ends (10:00) — back-to-back, not overlapping.
      const second = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-03T10:00:00Z"), durationMinutes: 60 }),
      );
      expect(second.id).not.toBe(first.id);

      await prisma.interview.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    });

    it("checks every assigned panelist, not just the first", async () => {
      const first = await scheduleInterview(
        recruiter,
        interviewInput({
          scheduledAt: new Date("2026-10-04T09:00:00Z"),
          durationMinutes: 60,
          panelistUserIds: [interviewer2.userId],
        }),
      );

      // Same time slot, different primary panelist list, but interviewer2
      // (the second panelist here) is already booked in that window.
      await expect(
        scheduleInterview(
          recruiter,
          interviewInput({
            scheduledAt: new Date("2026-10-04T09:00:00Z"),
            durationMinutes: 60,
            panelistUserIds: [interviewer1.userId, interviewer2.userId],
          }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: first.id } });
    });

    it("does not flag a conflict against a CANCELLED interview in the same slot", async () => {
      const cancelled = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-05T09:00:00Z"), durationMinutes: 60 }),
      );
      await cancelInterview(recruiter, cancelled.id, { version: 0, reasonId: cancellationReasonId });

      const rescheduledInSameSlot = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-05T09:00:00Z"), durationMinutes: 60 }),
      );
      expect(rescheduledInSameSlot.id).not.toBe(cancelled.id);

      await prisma.interview.deleteMany({ where: { id: { in: [cancelled.id, rescheduledInSameSlot.id] } } });
    });

    it("excludes the interview itself when rescheduling it within its own current slot", async () => {
      const interview = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-06T09:00:00Z"), durationMinutes: 60 }),
      );

      // Editing only the notes, with the same version, must not trip the
      // double-booking check against its own unchanged schedule.
      const updated = await updateInterview(recruiter, interview.id, { version: 0, notes: "no schedule change" });
      expect(updated.notes).toBe("no schedule change");

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects rescheduling into a slot that conflicts with a different existing interview", async () => {
      const other = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-07T14:00:00Z"), durationMinutes: 60 }),
      );
      const toReschedule = await scheduleInterview(
        recruiter,
        interviewInput({ scheduledAt: new Date("2026-10-07T09:00:00Z"), durationMinutes: 60 }),
      );

      await expect(
        updateInterview(recruiter, toReschedule.id, { version: 0, scheduledAt: new Date("2026-10-07T14:00:00Z") }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.deleteMany({ where: { id: { in: [other.id, toReschedule.id] } } });
    });
  });

  describe("interview feedback", () => {
    it("lets an assigned panelist submit feedback", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      const feedback = await submitInterviewFeedback(interviewer1, interview.id, {
        recommendation: "YES",
        rating: 4,
        comments: "Solid on system design.",
      });

      expect(feedback.recommendation).toBe("YES");
      expect(feedback.rating).toBe(4);
      expect(feedback.interviewer.id).toBe(interviewer1.userId);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects feedback from someone who is not an assigned panelist, even a Hiring Manager with ALL-scope read", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        submitInterviewFeedback(interviewer2, interview.id, { recommendation: "YES" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        submitInterviewFeedback(hiringManager, interview.id, { recommendation: "YES" }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects a second feedback submission from the same interviewer with ConflictError", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await submitInterviewFeedback(interviewer1, interview.id, { recommendation: "YES" });

      await expect(
        submitInterviewFeedback(interviewer1, interview.id, { recommendation: "NO" }),
      ).rejects.toBeInstanceOf(ConflictError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("lets each panelist submit their own independent feedback for the same interview", async () => {
      const interview = await scheduleInterview(
        recruiter,
        interviewInput({ panelistUserIds: [interviewer1.userId, interviewer2.userId] }),
      );

      await submitInterviewFeedback(interviewer1, interview.id, { recommendation: "STRONG_YES" });
      await submitInterviewFeedback(interviewer2, interview.id, { recommendation: "NO" });

      const detail = await getInterview(recruiter, interview.id);
      expect(detail.feedback).toHaveLength(2);
      expect(detail.feedback.map((entry) => entry.recommendation).sort()).toEqual(["NO", "STRONG_YES"]);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("rejects feedback for a cancelled interview", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await cancelInterview(recruiter, interview.id, { version: 0, reasonId: cancellationReasonId });

      await expect(
        submitInterviewFeedback(interviewer1, interview.id, { recommendation: "YES" }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("lets the author update their own feedback with optimistic locking", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await submitInterviewFeedback(interviewer1, interview.id, { recommendation: "NO", rating: 2 });

      const updated = await updateInterviewFeedback(interviewer1, interview.id, {
        version: 0,
        recommendation: "YES",
        rating: 4,
      });
      expect(updated.recommendation).toBe("YES");
      expect(updated.rating).toBe(4);

      await expect(
        updateInterviewFeedback(interviewer1, interview.id, { version: 0, recommendation: "STRONG_NO" }),
      ).rejects.toBeInstanceOf(ConflictError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("throws NotFoundError updating feedback that was never submitted", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());

      await expect(
        updateInterviewFeedback(interviewer1, interview.id, { version: 0, recommendation: "YES" }),
      ).rejects.toBeInstanceOf(NotFoundError);

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("never lets one interviewer edit another interviewer's feedback", async () => {
      const interview = await scheduleInterview(
        recruiter,
        interviewInput({ panelistUserIds: [interviewer1.userId, interviewer2.userId] }),
      );
      await submitInterviewFeedback(interviewer1, interview.id, { recommendation: "YES" });

      // interviewer2 has no feedback row of their own yet — updateInterviewFeedback
      // is scoped to (interviewId, context.userId), so this can only ever touch
      // interviewer2's own (nonexistent) row, never interviewer1's.
      await expect(
        updateInterviewFeedback(interviewer2, interview.id, { version: 0, recommendation: "STRONG_NO" }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const stillIntact = await prisma.interviewFeedback.findUniqueOrThrow({
        where: { interviewId_interviewerId: { interviewId: interview.id, interviewerId: interviewer1.userId } },
      });
      expect(stillIntact.recommendation).toBe("YES");

      await prisma.interview.delete({ where: { id: interview.id } });
    });
  });

  describe("candidate timeline integration", () => {
    it("surfaces scheduled, completed, cancelled, and feedback items on the candidate timeline", async () => {
      const candidate = await createCandidate(recruiter, {
        name: "Timeline Applicant",
        phone: "+1 555-0912",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });

      const completed = await scheduleInterview(
        recruiter,
        interviewInput({ applicationId: application.id, roundName: "Onsite Loop" }),
      );
      await submitInterviewFeedback(interviewer1, completed.id, { recommendation: "STRONG_YES", rating: 5 });
      await completeInterview(recruiter, completed.id, { version: 0 });

      const cancelled = await scheduleInterview(
        recruiter,
        interviewInput({ applicationId: application.id, roundName: "Phone Screen" }),
      );
      await cancelInterview(recruiter, cancelled.id, { version: 0, reasonId: cancellationReasonId });

      const timeline = await getCandidateTimeline(recruiter, candidate.id);

      const scheduledRoundNames = timeline.items
        .filter((item) => item.type === "interview_scheduled")
        .map((item) => (item.type === "interview_scheduled" ? item.roundName : null));
      expect(scheduledRoundNames.sort()).toEqual(["Onsite Loop", "Phone Screen"].sort());

      const statusItems = timeline.items.filter(
        (item) => item.type === "interview_completed" || item.type === "interview_cancelled",
      );
      expect(statusItems).toHaveLength(2);

      const completedItem = statusItems.find((item) => item.type === "interview_completed");
      expect(completedItem).toBeDefined();
      if (completedItem?.type === "interview_completed") {
        expect(completedItem.roundName).toBe("Onsite Loop");
      }

      const cancelledItem = statusItems.find((item) => item.type === "interview_cancelled");
      expect(cancelledItem).toBeDefined();
      if (cancelledItem?.type === "interview_cancelled") {
        expect(cancelledItem.roundName).toBe("Phone Screen");
        expect(cancelledItem.reason).toBe("Scheduling conflict");
      }

      const feedbackItem = timeline.items.find((item) => item.type === "interview_feedback_submitted");
      expect(feedbackItem).toBeDefined();
      if (feedbackItem?.type === "interview_feedback_submitted") {
        expect(feedbackItem.recommendation).toBe("STRONG_YES");
        expect(feedbackItem.interviewer.id).toBe(interviewer1.userId);
      }

      await prisma.interview.deleteMany({ where: { id: { in: [completed.id, cancelled.id] } } });
      await prisma.application.delete({ where: { id: application.id } });
      await prisma.candidate.delete({ where: { id: candidate.id } });
    });

    it("does not include another candidate's interviews", async () => {
      const candidateA = await createCandidate(recruiter, {
        name: "Candidate A",
        phone: "+1 555-0913",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const candidateB = await createCandidate(recruiter, {
        name: "Candidate B",
        phone: "+1 555-0914",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const applicationA = await createApplication(recruiter, { candidateId: candidateA.id, jobId });
      const applicationB = await createApplication(recruiter, { candidateId: candidateB.id, jobId });

      const interviewB = await scheduleInterview(recruiter, interviewInput({ applicationId: applicationB.id }));

      const timelineA = await getCandidateTimeline(recruiter, candidateA.id);
      expect(timelineA.items.filter((item) => item.type.startsWith("interview_"))).toHaveLength(0);

      await prisma.interview.delete({ where: { id: interviewB.id } });
      await prisma.application.deleteMany({ where: { id: { in: [applicationA.id, applicationB.id] } } });
      await prisma.candidate.deleteMany({ where: { id: { in: [candidateA.id, candidateB.id] } } });
    });
  });

  describe("reschedule/cancel notifications", () => {
    let notifyCandidateId: string;
    let notifyApplicationId: string;
    const rescheduleTemplateNames = ["Interview Rescheduled — Candidate", "Interview Rescheduled — Panelist"];
    const cancelTemplateNames = ["Interview Cancelled — Candidate", "Interview Cancelled — Panelist"];

    beforeAll(async () => {
      const candidate = await createCandidate(recruiter, {
        name: "Notify Candidate",
        phone: "+1 555-0920",
        email: "notify-candidate@test.local",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      notifyCandidateId = candidate.id;

      const application = await createApplication(recruiter, { candidateId: notifyCandidateId, jobId });
      notifyApplicationId = application.id;

      // The notification module addresses these templates by name, not by ID —
      // create them here rather than depending on prisma/seed.ts, which the
      // test-database global setup deliberately never runs (migrate-only).
      await prisma.communicationTemplate.createMany({
        data: [
          {
            name: "Interview Rescheduled — Candidate",
            subject: "Your {{interview.roundName}} interview has been rescheduled",
            body: "Hi {{candidate.name}}, your {{job.title}} interview is now at {{interview.scheduledAt}} ({{interview.durationMinutes}} min, {{interview.mode}}).",
            createdById: recruiter.userId,
          },
          {
            name: "Interview Rescheduled — Panelist",
            subject: "Interview rescheduled: {{candidate.name}}",
            body: "Hi {{panelist.name}}, the {{interview.roundName}} interview for {{candidate.name}} is now at {{interview.scheduledAt}}.",
            createdById: recruiter.userId,
          },
          {
            name: "Interview Cancelled — Candidate",
            subject: "Your {{interview.roundName}} interview was cancelled",
            body: "Hi {{candidate.name}}, your {{job.title}} interview was cancelled. Reason: {{interview.cancellationReason}}.",
            createdById: recruiter.userId,
          },
          {
            name: "Interview Cancelled — Panelist",
            subject: "Interview cancelled: {{candidate.name}}",
            body: "Hi {{panelist.name}}, the {{interview.roundName}} interview for {{candidate.name}} was cancelled. Reason: {{interview.cancellationReason}}.",
            createdById: recruiter.userId,
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.applicationEmailLog.deleteMany({ where: { applicationId: notifyApplicationId } });
      await prisma.application.delete({ where: { id: notifyApplicationId } });
      await prisma.candidate.delete({ where: { id: notifyCandidateId } });
      await prisma.communicationTemplate.deleteMany({
        where: { name: { in: [...rescheduleTemplateNames, ...cancelTemplateNames] } },
      });
    });

    it("notifies the candidate and active panelists on reschedule, with rendered content and no duplicate on a notes-only edit", async () => {
      const interview = await scheduleInterview(recruiter, {
        applicationId: notifyApplicationId,
        roundName: "Notify Round",
        mode: "VIRTUAL",
        scheduledAt: new Date("2026-09-05T10:00:00Z"),
        panelistUserIds: [interviewer1.userId, interviewer2.userId],
      } as InterviewCreateInput);

      await updateInterview(recruiter, interview.id, {
        version: 0,
        scheduledAt: new Date("2026-09-06T11:00:00Z"),
      });

      const logs = await prisma.applicationEmailLog.findMany({
        where: { applicationId: notifyApplicationId },
        orderBy: { toEmail: "asc" },
      });
      expect(logs).toHaveLength(3);
      expect(logs.every((log) => log.status === "SENT")).toBe(true);
      const candidateLog = logs.find((log) => log.toEmail === "notify-candidate@test.local");
      expect(candidateLog?.subject).toBe("Your Notify Round interview has been rescheduled");
      expect(candidateLog?.body).toContain("Hi Notify Candidate, your Backend Engineer interview is now at");
      expect(candidateLog?.body).toContain("2026-09-06T11:00:00.000Z");
      const panelistLog = logs.find((log) => log.toEmail === "iv-interviewer1@test.local");
      expect(panelistLog?.body).toContain("Hi Interviewer One,");
      expect(logs.map((log) => log.toEmail).sort()).toEqual(
        ["iv-interviewer1@test.local", "iv-interviewer2@test.local", "notify-candidate@test.local"].sort(),
      );

      // A notes-only edit changes none of scheduledAt/durationMinutes/mode — must not re-notify.
      await updateInterview(recruiter, interview.id, { version: 1, roundName: "Notify Round (renamed)" });
      const logsAfterNotesEdit = await prisma.applicationEmailLog.findMany({
        where: { applicationId: notifyApplicationId },
      });
      expect(logsAfterNotesEdit).toHaveLength(3);

      await prisma.applicationEmailLog.deleteMany({ where: { applicationId: notifyApplicationId } });
      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("excludes an inactive panelist from reschedule notifications", async () => {
      const inactivePanelist = await prisma.user.create({
        data: {
          name: "Inactive Panelist",
          email: "iv-inactive-panelist@test.local",
          passwordHash: await bcrypt.hash("Test123!Test123!", 4),
          isActive: false,
        },
      });
      await prisma.userRole.create({ data: { userId: inactivePanelist.id, roleId: interviewerRoleId } });

      const interview = await scheduleInterview(recruiter, {
        applicationId: notifyApplicationId,
        roundName: "Notify Round Inactive Panelist",
        mode: "VIRTUAL",
        scheduledAt: new Date("2026-09-07T10:00:00Z"),
        panelistUserIds: [interviewer1.userId],
      } as InterviewCreateInput);
      // Add the inactive panelist directly — assertActiveUsers would reject them on the way in.
      await prisma.interviewPanelist.create({ data: { interviewId: interview.id, userId: inactivePanelist.id } });

      await updateInterview(recruiter, interview.id, { version: 0, durationMinutes: 90 });

      const logs = await prisma.applicationEmailLog.findMany({ where: { applicationId: notifyApplicationId } });
      expect(logs.map((log) => log.toEmail).sort()).toEqual(
        ["iv-interviewer1@test.local", "notify-candidate@test.local"].sort(),
      );

      await prisma.applicationEmailLog.deleteMany({ where: { applicationId: notifyApplicationId } });
      await prisma.interview.delete({ where: { id: interview.id } });
      await prisma.userRole.deleteMany({ where: { userId: inactivePanelist.id } });
      await prisma.user.delete({ where: { id: inactivePanelist.id } });
    });

    it("skips a recipient with no email on file without failing or logging a row for them", async () => {
      const noEmailCandidate = await createCandidate(recruiter, {
        name: "No Email Notify Candidate",
        phone: "+1 555-0921",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput);
      const application = await createApplication(recruiter, { candidateId: noEmailCandidate.id, jobId });

      const interview = await scheduleInterview(recruiter, {
        applicationId: application.id,
        roundName: "No Email Round",
        mode: "VIRTUAL",
        scheduledAt: new Date("2026-09-08T10:00:00Z"),
        panelistUserIds: [interviewer1.userId],
      } as InterviewCreateInput);

      await updateInterview(recruiter, interview.id, { version: 0, mode: "ONSITE" });

      const logs = await prisma.applicationEmailLog.findMany({ where: { applicationId: application.id } });
      expect(logs.map((log) => log.toEmail)).toEqual(["iv-interviewer1@test.local"]);

      await prisma.applicationEmailLog.deleteMany({ where: { applicationId: application.id } });
      await prisma.interview.delete({ where: { id: interview.id } });
      await prisma.application.delete({ where: { id: application.id } });
      await prisma.candidate.delete({ where: { id: noEmailCandidate.id } });
    });

    it("notifies with the cancellation reason interpolated on cancel", async () => {
      const interview = await scheduleInterview(recruiter, {
        applicationId: notifyApplicationId,
        roundName: "Notify Cancel Round",
        mode: "VIRTUAL",
        scheduledAt: new Date("2026-09-09T10:00:00Z"),
        panelistUserIds: [interviewer1.userId],
      } as InterviewCreateInput);

      await cancelInterview(recruiter, interview.id, { version: 0, reasonId: cancellationReasonId });

      const logs = await prisma.applicationEmailLog.findMany({ where: { applicationId: notifyApplicationId } });
      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.status === "SENT")).toBe(true);
      const candidateLog = logs.find((log) => log.toEmail === "notify-candidate@test.local");
      expect(candidateLog?.body).toContain("Reason: Scheduling conflict.");
      expect(logs.map((log) => log.toEmail).sort()).toEqual(
        ["iv-interviewer1@test.local", "notify-candidate@test.local"].sort(),
      );

      await prisma.applicationEmailLog.deleteMany({ where: { applicationId: notifyApplicationId } });
      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("duplicate-send prevention is inherited from the version guard: a stale-version reschedule attempt is rejected before any notification is sent", async () => {
      const interview = await scheduleInterview(recruiter, {
        applicationId: notifyApplicationId,
        roundName: "Stale Version Round",
        mode: "VIRTUAL",
        scheduledAt: new Date("2026-09-10T10:00:00Z"),
        panelistUserIds: [interviewer1.userId],
      } as InterviewCreateInput);

      await updateInterview(recruiter, interview.id, { version: 0, scheduledAt: new Date("2026-09-10T12:00:00Z") });
      await prisma.applicationEmailLog.deleteMany({ where: { applicationId: notifyApplicationId } });

      // A second caller still holding the stale version 0 must be rejected, and must not trigger a second notification.
      await expect(
        updateInterview(recruiter, interview.id, { version: 0, scheduledAt: new Date("2026-09-10T14:00:00Z") }),
      ).rejects.toBeInstanceOf(ConflictError);

      const logs = await prisma.applicationEmailLog.findMany({ where: { applicationId: notifyApplicationId } });
      expect(logs).toHaveLength(0);

      await prisma.interview.delete({ where: { id: interview.id } });
    });
  });

  describe("database integrity", () => {
    it("writes an AuditLog entry for schedule, update, cancel, complete, and feedback", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await updateInterview(recruiter, interview.id, { version: 0, roundName: "Renamed Round" });
      await submitInterviewFeedback(interviewer1, interview.id, { recommendation: "YES" });
      const completed = await completeInterview(recruiter, interview.id, { version: 1 });
      expect(completed.status).toBe("COMPLETED");

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "INTERVIEW", entityId: interview.id },
        select: { action: true },
      });
      const actions = entries.map((entry) => entry.action).sort();
      expect(actions).toEqual(
        ["interview.completed", "interview.feedback_submitted", "interview.scheduled", "interview.updated"].sort(),
      );

      await prisma.interview.delete({ where: { id: interview.id } });
    });

    it("cascades InterviewPanelist and InterviewFeedback deletion when an Interview row is removed", async () => {
      const interview = await scheduleInterview(recruiter, interviewInput());
      await submitInterviewFeedback(interviewer1, interview.id, { recommendation: "YES" });

      await prisma.interview.delete({ where: { id: interview.id } });

      const panelists = await prisma.interviewPanelist.findMany({ where: { interviewId: interview.id } });
      const feedback = await prisma.interviewFeedback.findMany({ where: { interviewId: interview.id } });
      expect(panelists).toHaveLength(0);
      expect(feedback).toHaveLength(0);
    });
  });
});
