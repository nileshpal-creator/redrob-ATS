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
