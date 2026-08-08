import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { runDueInterviewReminders } from "@/lib/services/interview-reminders";
import { cancelInterview, completeInterview, scheduleInterview, updateInterview } from "@/lib/services/interviews";
import { createApplication } from "@/lib/services/applications";
import { createCandidate } from "@/lib/services/candidates";
import { createJob } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";
import type { InterviewCreateInput } from "@/lib/validations/interview";

// MAIL_PROVIDER must resolve to TestFailureMailProvider before the first
// call to getMailProvider() in this file's isolated module registry (see
// vitest.config.mts — each test file gets its own module cache, so this
// never affects any other test file's mail sends).
process.env.MAIL_PROVIDER = "test_failure";
const FAIL_ONCE_EMAIL = "candidate+simulate-mail-failure:1@test.local";
const ALWAYS_FAIL_EMAIL = "candidate+simulate-mail-failure@test.local";

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

describe("runDueInterviewReminders", () => {
  let recruiterRoleId: string;
  let recruiter: SessionContext;
  let panelist1Id: string;
  let panelist2Id: string;

  let departmentId: string;
  let locationId: string;
  let jobId: string;
  let organizationId: string;

  const jobInput = (): JobCreateInput =>
    ({
      title: "Reminder Test Role",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    }) as JobCreateInput;

  async function newApplicationId(phone: string, email: string | null = "candidate@example.com") {
    const candidate = await createCandidate(recruiter, {
      name: "Reminder Candidate",
      phone,
      email: email ?? undefined,
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
    const application = await createApplication(recruiter, { candidateId: candidate.id, jobId });
    return application.id;
  }

  async function scheduleTestInterview(applicationId: string, scheduledAt: Date, panelistUserIds = [panelist1Id]) {
    return scheduleInterview(recruiter, {
      applicationId,
      roundName: "Technical Round",
      mode: "VIRTUAL",
      scheduledAt,
      panelistUserIds,
    } as InterviewCreateInput);
  }

  async function setLeadMinutes(leadMinutes: number[]) {
    await prisma.organization.update({ where: { id: organizationId }, data: { interviewReminderLeadMinutes: leadMinutes } });
  }

  async function seedReminderTemplates() {
    const existingCandidate = await prisma.communicationTemplate.findFirst({ where: { name: "Interview Reminder — Candidate" } });
    if (!existingCandidate) {
      await prisma.communicationTemplate.create({
        data: {
          name: "Interview Reminder — Candidate",
          channel: "EMAIL",
          subject: "Reminder for {{job.title}}",
          body: "Hi {{candidate.name}}, reminder in {{reminder.leadTime}}.",
          createdById: recruiter.userId,
        },
      });
    }
    const existingPanelist = await prisma.communicationTemplate.findFirst({ where: { name: "Interview Reminder — Panelist" } });
    if (!existingPanelist) {
      await prisma.communicationTemplate.create({
        data: {
          name: "Interview Reminder — Panelist",
          channel: "EMAIL",
          subject: "Panel reminder for {{job.title}}",
          body: "Hi {{panelist.name}}, reminder in {{reminder.leadTime}}.",
          createdById: recruiter.userId,
        },
      });
    }
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Reminder Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "INTERVIEW", action: "CREATE", scope: "ALL" },
              { resource: "INTERVIEW", action: "UPDATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const [recruiterUser, panelist1, panelist2] = await Promise.all([
      prisma.user.create({ data: { name: "Reminder Recruiter", email: "reminder-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Panelist One", email: "reminder-panelist1@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Panelist Two", email: "reminder-panelist2@test.local", passwordHash } }),
    ]);
    panelist1Id = panelist1.id;
    panelist2Id = panelist2.id;

    await prisma.userRole.create({ data: { userId: recruiterUser.id, roleId: recruiterRoleId } });
    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Reminder Recruiter", isSuperAdmin: false }] });

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

    // No prisma/seed.ts run against the test DB (see tests/setup/global-setup.ts —
    // migrate deploy only) — the Organization singleton must be created here,
    // the same "this test file owns its own fixtures" convention every other
    // file in this suite already follows.
    const organization = await prisma.organization.create({
      data: { name: "Test Org", interviewReminderLeadMinutes: [60] },
    });
    organizationId = organization.id;

    await seedReminderTemplates();
  });

  afterAll(async () => {
    await prisma.interviewReminder.deleteMany({});
    await prisma.interviewFeedback.deleteMany({});
    await prisma.interviewPanelist.deleteMany({});
    await prisma.interview.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({ where: { createdById: recruiter.userId } });
    await prisma.communicationTemplate.deleteMany({
      where: { name: { in: ["Interview Reminder — Candidate", "Interview Reminder — Panelist"] } },
    });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: recruiterRoleId } });
    await prisma.user.deleteMany({
      where: { email: { in: ["reminder-recruiter@test.local", "reminder-panelist1@test.local", "reminder-panelist2@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: recruiterRoleId } });
  });

  it("reports no work when nothing is due", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9001");
    // Scheduled 5 hours out — the 60-minute lead time is nowhere close.
    await scheduleTestInterview(applicationId, new Date(Date.now() + 5 * 60 * 60 * 1000));

    const result = await runDueInterviewReminders(new Date());
    expect(result.sent).toBe(0);
  });

  it("sends a due reminder to both the candidate and the panelist as separate rows", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9002");
    const now = new Date("2026-06-01T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000); // due in 30 min, lead is 60
    const interview = await scheduleTestInterview(applicationId, scheduledAt);

    const result = await runDueInterviewReminders(now);
    expect(result.sent).toBe(2); // candidate + 1 panelist

    const rows = await prisma.interviewReminder.findMany({ where: { interviewId: interview.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "SENT")).toBe(true);
    expect(rows.map((row) => row.recipientType).sort()).toEqual(["CANDIDATE", "PANELIST"]);
  });

  it("does not re-send an already-SENT reminder on a repeated invocation (idempotent)", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9003");
    const now = new Date("2026-06-02T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt);

    const first = await runDueInterviewReminders(now);
    expect(first.sent).toBe(2);

    const second = await runDueInterviewReminders(new Date(now.getTime() + 1000));
    expect(second.sent).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);

    const rows = await prisma.interviewReminder.findMany({ where: { interviewId: interview.id } });
    expect(rows).toHaveLength(2); // still exactly one row per recipient, never duplicated
  });

  it("lets only one of two concurrent invocations send the same due reminder", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9004");
    const now = new Date("2026-06-03T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []); // candidate only, simplest race to reason about

    const [a, b] = await Promise.all([runDueInterviewReminders(now), runDueInterviewReminders(now)]);
    const totalSent = a.sent + b.sent;
    expect(totalSent).toBe(1);

    const rows = await prisma.interviewReminder.findMany({ where: { interviewId: interview.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
  });

  it("retries a failed send and eventually succeeds", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9005", FAIL_ONCE_EMAIL);
    const now = new Date("2026-06-04T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []);

    const first = await runDueInterviewReminders(now);
    expect(first.retrying).toBe(1);

    const row = await prisma.interviewReminder.findFirstOrThrow({ where: { interviewId: interview.id } });
    expect(row.status).toBe("RETRYING");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/simulated failure/i);
    expect(row.nextAttemptAt).not.toBeNull();

    // Advance past the backoff window and retry.
    const retryTime = new Date(row.nextAttemptAt!.getTime() + 1000);
    const second = await runDueInterviewReminders(retryTime);
    expect(second.sent).toBe(1);

    const updated = await prisma.interviewReminder.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("SENT");
    expect(updated.attempts).toBe(2);
  });

  it("permanently fails after exhausting retry attempts, and stops retrying", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9006", ALWAYS_FAIL_EMAIL);
    const now = new Date("2026-06-05T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []);

    let current = now;
    for (let i = 0; i < 3; i += 1) {
      await runDueInterviewReminders(current);
      const row = await prisma.interviewReminder.findFirstOrThrow({ where: { interviewId: interview.id } });
      if (row.status === "FAILED") break;
      current = new Date(row.nextAttemptAt!.getTime() + 1000);
    }

    const finalRow = await prisma.interviewReminder.findFirstOrThrow({ where: { interviewId: interview.id } });
    expect(finalRow.status).toBe("FAILED");
    expect(finalRow.attempts).toBe(3);

    // A later run must not touch it again.
    const later = await runDueInterviewReminders(new Date(current.getTime() + 24 * 60 * 60 * 1000));
    expect(later.sent + later.retrying + later.failed).toBe(0);
    const stillSame = await prisma.interviewReminder.findUniqueOrThrow({ where: { id: finalRow.id } });
    expect(stillSame.attempts).toBe(3);
  });

  it("records a permanent FAILED reminder (not an infinite retry) when the candidate has no email", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9007", null);
    const now = new Date("2026-06-06T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []);

    const result = await runDueInterviewReminders(now);
    expect(result.failed).toBe(1);

    const row = await prisma.interviewReminder.findFirstOrThrow({ where: { interviewId: interview.id } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/no email/i);

    const later = await runDueInterviewReminders(new Date(now.getTime() + 60 * 60 * 1000));
    expect(later.failed).toBe(0); // never retried
  });

  it("a failing panelist reminder does not block the candidate's own reminder in the same run", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9008");
    await prisma.user.update({ where: { id: panelist2Id }, data: { email: ALWAYS_FAIL_EMAIL } });
    const now = new Date("2026-06-07T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, [panelist2Id]);

    const result = await runDueInterviewReminders(now);
    expect(result.sent).toBe(1); // candidate
    expect(result.retrying).toBe(1); // panelist2's marked address

    const rows = await prisma.interviewReminder.findMany({ where: { interviewId: interview.id } });
    expect(rows.find((row) => row.recipientType === "CANDIDATE")?.status).toBe("SENT");
    expect(rows.find((row) => row.recipientType === "PANELIST")?.status).toBe("RETRYING");

    await prisma.user.update({ where: { id: panelist2Id }, data: { email: "reminder-panelist2@test.local" } });
  });

  it("never sends a reminder for a cancelled interview", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9009");
    const now = new Date("2026-06-08T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []);

    const reasonList = await prisma.controlledList.create({
      data: { key: "INTERVIEW_CANCELLATION_REASON", label: "Reasons", values: { create: { value: "r", label: "R" } } },
    });
    const reasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: reasonList.id } })).id;
    await cancelInterview(recruiter, interview.id, { version: interview.version, reasonId } as never);

    const result = await runDueInterviewReminders(now);
    expect(result.sent).toBe(0);
    const rows = await prisma.interviewReminder.findMany({ where: { interviewId: interview.id } });
    expect(rows).toHaveLength(0);

    await prisma.controlledListValue.deleteMany({ where: { listId: reasonList.id } });
    await prisma.controlledList.delete({ where: { id: reasonList.id } });
  });

  it("never sends a reminder for a completed interview", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9010");
    const now = new Date("2026-06-09T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []);

    await completeInterview(recruiter, interview.id, { version: interview.version } as never);

    const result = await runDueInterviewReminders(now);
    expect(result.sent).toBe(0);
    const rows = await prisma.interviewReminder.findMany({ where: { interviewId: interview.id } });
    expect(rows).toHaveLength(0);
  });

  it("rescheduling to a later time doesn't skip the new occurrence's own reminder", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9011");
    const now = new Date("2026-06-10T12:00:00.000Z");
    const firstScheduledAt = new Date(now.getTime() + 30 * 60 * 1000);
    const interview = await scheduleTestInterview(applicationId, firstScheduledAt, []);

    const firstRun = await runDueInterviewReminders(now);
    expect(firstRun.sent).toBe(1);

    const newScheduledAt = new Date(now.getTime() + 10 * 60 * 60 * 1000); // 10 hours later
    const rescheduled = await updateInterview(recruiter, interview.id, {
      version: interview.version,
      scheduledAt: newScheduledAt,
    } as never);

    // At `now`, the new time's own 60-min-before window hasn't opened yet.
    const stillNothingNew = await runDueInterviewReminders(now);
    expect(stillNothingNew.sent).toBe(0);

    // Once the new time's own lead window opens, a *new* row gets created and sent.
    const secondDueTime = new Date(newScheduledAt.getTime() - 30 * 60 * 1000);
    const secondRun = await runDueInterviewReminders(secondDueTime);
    expect(secondRun.sent).toBe(1);

    const rows = await prisma.interviewReminder.findMany({
      where: { interviewId: rescheduled.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].scheduledAtFingerprint).toBe(firstScheduledAt.toISOString());
    expect(rows[1].scheduledAtFingerprint).toBe(newScheduledAt.toISOString());
    expect(rows.every((row) => row.status === "SENT")).toBe(true);
  });

  it("treats due-time math as a fixed offset from an absolute UTC instant — no timezone drift", async () => {
    await setLeadMinutes([60]);
    const applicationId = await newApplicationId("+1 555-9012");
    const scheduledAt = new Date("2026-06-11T12:00:00.000Z");
    const interview = await scheduleTestInterview(applicationId, scheduledAt, []);

    // One minute before the lead window opens — not yet due.
    const justBefore = new Date(scheduledAt.getTime() - 61 * 60 * 1000);
    const notYet = await runDueInterviewReminders(justBefore);
    expect(notYet.sent).toBe(0);

    // Exactly at the lead window boundary — due.
    const dueAt = new Date(scheduledAt.getTime() - 60 * 60 * 1000);
    const due = await runDueInterviewReminders(dueAt);
    expect(due.sent).toBe(1);

    const row = await prisma.interviewReminder.findFirstOrThrow({ where: { interviewId: interview.id } });
    expect(row.status).toBe("SENT");
  });

  it("stops after the configured interview/reminder batch limits, leaving the rest for a later run", async () => {
    await setLeadMinutes([60]);
    const now = new Date("2026-06-12T12:00:00.000Z");
    const scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);

    const applicationIds = await Promise.all(
      Array.from({ length: 3 }, (_, i) => newApplicationId(`+1 555-92${String(i).padStart(2, "0")}`)),
    );
    const interviews = await Promise.all(applicationIds.map((id) => scheduleTestInterview(id, scheduledAt, [])));

    const limited = await runDueInterviewReminders(now, { maxInterviews: 2, maxReminders: 100 });
    expect(limited.interviewsEvaluated).toBe(2);
    expect(limited.sent).toBe(2);

    const remaining = await prisma.interviewReminder.count({
      where: { interviewId: { in: interviews.map((i) => i.id) } },
    });
    expect(remaining).toBe(2); // the third interview's reminder wasn't attempted at all yet

    // A later run (no artificial limit) picks up the rest.
    const rest = await runDueInterviewReminders(new Date(now.getTime() + 1000));
    expect(rest.sent).toBe(1);
  });
});
