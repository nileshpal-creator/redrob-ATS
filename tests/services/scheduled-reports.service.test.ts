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
});
