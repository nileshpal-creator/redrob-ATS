import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { runDueScheduledReports } from "@/lib/services/scheduled-reports";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("runDueScheduledReports", () => {
  let recruiterRoleId: string;
  let creatorUserId: string;
  let deactivatedUserId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const role = await prisma.role.create({
      data: {
        name: "Test Scheduled Reports Recruiter",
        rolePermissions: { createMany: { data: [{ resource: "JOB", action: "READ", scope: "ALL" }] } },
      },
    });
    recruiterRoleId = role.id;

    const [creator, deactivated] = await Promise.all([
      prisma.user.create({ data: { name: "Scheduler Creator", email: "scheduler-creator@test.local", passwordHash } }),
      prisma.user.create({
        data: { name: "Scheduler Deactivated", email: "scheduler-deactivated@test.local", passwordHash, isActive: false },
      }),
    ]);
    creatorUserId = creator.id;
    deactivatedUserId = deactivated.id;

    await prisma.userRole.createMany({
      data: [
        { userId: creatorUserId, roleId: recruiterRoleId },
        { userId: deactivatedUserId, roleId: recruiterRoleId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.savedReport.deleteMany({ where: { createdById: { in: [creatorUserId, deactivatedUserId] } } });
    await prisma.userRole.deleteMany({ where: { roleId: recruiterRoleId } });
    await prisma.user.deleteMany({ where: { id: { in: [creatorUserId, deactivatedUserId] } } });
    await prisma.role.deleteMany({ where: { id: recruiterRoleId } });
  });

  function savedReportData(overrides: Partial<Prisma.SavedReportUncheckedCreateInput> = {}): Prisma.SavedReportUncheckedCreateInput {
    return {
      name: "Scheduled Test Report",
      reportType: "RECRUITER_PRODUCTIVITY",
      filters: {},
      scheduleFrequency: "DAILY",
      recipientEmails: ["recipient@test.local"],
      exportFormat: "CSV",
      createdById: creatorUserId,
      ...overrides,
    };
  }

  it("runs a never-run scheduled report and marks it SENT", async () => {
    const report = await prisma.savedReport.create({ data: savedReportData() });

    const now = new Date();
    const result = await runDueScheduledReports(now);

    expect(result.dueCount).toBeGreaterThanOrEqual(1);
    expect(result.sentCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(updated.lastRunAt).toEqual(now);
    expect(updated.lastRunStatus).toBe("SENT");

    const entries = await prisma.auditLog.findMany({
      where: { entityType: "SAVED_REPORT", entityId: report.id, action: "saved_report.schedule_run" },
    });
    expect(entries).toHaveLength(1);
  });

  it("does not re-run a DAILY report whose last run was under 24h ago", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const report = await prisma.savedReport.create({
      data: savedReportData({ lastRunAt: oneHourAgo, lastRunStatus: "SENT" }),
    });

    await runDueScheduledReports(now);

    const unchanged = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(unchanged.lastRunAt).toEqual(oneHourAgo);
  });

  it("re-runs a DAILY report whose last run was over 24h ago", async () => {
    const now = new Date();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const report = await prisma.savedReport.create({
      data: savedReportData({ lastRunAt: twentyFiveHoursAgo, lastRunStatus: "SENT" }),
    });

    await runDueScheduledReports(now);

    const updated = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(updated.lastRunAt).toEqual(now);
  });

  it("treats a WEEKLY report's due threshold as 7 days, not 1", async () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * DAY_MS);
    const eightDaysAgo = new Date(now.getTime() - 8 * DAY_MS);

    const notDueYet = await prisma.savedReport.create({
      data: savedReportData({ scheduleFrequency: "WEEKLY", lastRunAt: threeDaysAgo, lastRunStatus: "SENT" }),
    });
    const due = await prisma.savedReport.create({
      data: savedReportData({ scheduleFrequency: "WEEKLY", lastRunAt: eightDaysAgo, lastRunStatus: "SENT" }),
    });

    await runDueScheduledReports(now);

    expect((await prisma.savedReport.findUniqueOrThrow({ where: { id: notDueYet.id } })).lastRunAt).toEqual(threeDaysAgo);
    expect((await prisma.savedReport.findUniqueOrThrow({ where: { id: due.id } })).lastRunAt).toEqual(now);
  });

  it("never touches a report with scheduleFrequency NONE, regardless of lastRunAt", async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - 365 * DAY_MS);
    const report = await prisma.savedReport.create({
      data: savedReportData({ scheduleFrequency: "NONE", lastRunAt: longAgo, lastRunStatus: "SENT" }),
    });

    await runDueScheduledReports(now);

    const unchanged = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(unchanged.lastRunAt).toEqual(longAgo);
  });

  it("marks a report FAILED when its creator account no longer resolves to a session", async () => {
    const report = await prisma.savedReport.create({ data: savedReportData({ createdById: deactivatedUserId }) });

    const now = new Date();
    const result = await runDueScheduledReports(now);

    expect(result.failedCount).toBeGreaterThanOrEqual(1);
    const updated = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(updated.lastRunAt).toEqual(now);
    expect(updated.lastRunStatus).toBe("FAILED");
  });

  it("Module 12 regression: lets only one of two concurrent invocations send the same due report", async () => {
    const report = await prisma.savedReport.create({ data: savedReportData() });

    const now = new Date();
    const [a, b] = await Promise.all([runDueScheduledReports(now), runDueScheduledReports(now)]);

    const totalSent = a.sentCount + b.sentCount;
    expect(totalSent).toBe(1);
    expect(a.skippedCount + b.skippedCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(updated.lastRunStatus).toBe("SENT");
    expect(updated.version).toBe(report.version + 1); // claimed exactly once, not twice
  });

  it("Module 12 regression: a second tick starting mid-send (after the claim, before the send finishes) must not also send", async () => {
    // Reproduces the exact gap an adversarial review found in the first fix
    // attempt: a version-only claim stops two callers who read the *same*
    // stale version, but not a *later* caller whose own fresh read happens
    // after the claim committed but before the send finished — because
    // `lastRunAt` (what `isDue` checks) wasn't updated until after the send.
    // The real fix stamps `lastRunAt` as part of the atomic claim itself, so
    // a later reader sees a fresh timestamp immediately, for the whole
    // duration of the send — simulated here by performing the exact same
    // claim query runDueScheduledReports itself runs, then invoking the real
    // function as "the next tick" before any send/finalize has happened.
    const report = await prisma.savedReport.create({ data: savedReportData() });
    const now = new Date();

    const claim = await prisma.savedReport.updateMany({
      where: { id: report.id, version: report.version },
      data: { version: { increment: 1 }, lastRunAt: now },
    });
    expect(claim.count).toBe(1);

    // "Tick B" starts here — while tick A's render/send/finalize (not
    // simulated) would still be in flight in production.
    const tickB = await runDueScheduledReports(new Date(now.getTime() + 1000));
    const reportUnchangedByTickB = await prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } });

    expect(reportUnchangedByTickB.lastRunStatus).toBeNull(); // tick B never touched it
    expect(reportUnchangedByTickB.version).toBe(report.version + 1); // still just tick A's claim
    void tickB;
  });

  it("caps how many due reports one call processes, leaving the rest for a later run", async () => {
    const now = new Date();
    // Deliberately much older than any other fixture in this file (which
    // all sit within a few days of "now") so these three sort first and
    // unambiguously under `orderBy: { lastRunAt: "asc" }`, regardless of
    // leftover state from earlier tests in this shared-state file.
    const reports = await Promise.all([
      prisma.savedReport.create({ data: savedReportData({ name: "Batch Report A", lastRunAt: new Date(now.getTime() - 30 * DAY_MS), lastRunStatus: "SENT" }) }),
      prisma.savedReport.create({ data: savedReportData({ name: "Batch Report B", lastRunAt: new Date(now.getTime() - 29 * DAY_MS), lastRunStatus: "SENT" }) }),
      prisma.savedReport.create({ data: savedReportData({ name: "Batch Report C", lastRunAt: new Date(now.getTime() - 28 * DAY_MS), lastRunStatus: "SENT" }) }),
    ]);

    const limited = await runDueScheduledReports(now, 2);
    expect(limited.dueCount).toBe(2);
    expect(limited.sentCount).toBe(2);

    const untouched = await prisma.savedReport.findUniqueOrThrow({ where: { id: reports[2].id } });
    expect(untouched.lastRunAt).toEqual(new Date(now.getTime() - 28 * DAY_MS)); // third report wasn't attempted at all this call

    const rest = await runDueScheduledReports(new Date(now.getTime() + 1000), 2);
    expect(rest.sentCount).toBe(1);
  });
});
