import { prisma } from "@/lib/prisma";
import type { ReportScheduleFrequency } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { getSessionContextForUser } from "@/lib/authz/session-context-for-user";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { getMailProvider } from "@/lib/mail";
import { renderReportBuffer } from "@/lib/services/report-export";

const DAY_MS = 24 * 60 * 60 * 1000;
const FREQUENCY_INTERVAL_MS: Record<Exclude<ReportScheduleFrequency, "NONE">, number> = {
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
};

function isDue(scheduleFrequency: "DAILY" | "WEEKLY", lastRunAt: Date | null, now: Date): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= FREQUENCY_INTERVAL_MS[scheduleFrequency];
}

/**
 * No cron/queue infrastructure exists anywhere in this app (there is no
 * long-running worker process beside the Next.js server) — same environment
 * limit MailProvider/StorageProvider/HrisProvider already document for
 * their own "no real external system" providers. This function is the real
 * business logic for §10.5's "schedule-based email delivery"; actually
 * invoking it on a schedule is external infra this pass does not provide
 * (an OS cron or a hosting platform's scheduled function hitting
 * POST /api/saved-reports/run-due). It re-applies each report's *creator's*
 * own RBAC scope at run time (getSessionContextForUser), the same
 * row-level-security guarantee ad-hoc report viewing gets.
 */
export async function runDueScheduledReports(now: Date = new Date()) {
  const candidates = await prisma.savedReport.findMany({
    where: { scheduleFrequency: { in: ["DAILY", "WEEKLY"] } },
  });

  const due = candidates.filter((report) => isDue(report.scheduleFrequency as "DAILY" | "WEEKLY", report.lastRunAt, now));

  let sentCount = 0;
  let failedCount = 0;

  for (const report of due) {
    const creatorContext = await getSessionContextForUser(report.createdById);
    if (!creatorContext || report.recipientEmails.length === 0) {
      await prisma.savedReport.update({ where: { id: report.id }, data: { lastRunAt: now, lastRunStatus: "FAILED" } });
      failedCount += 1;
      continue;
    }

    try {
      const { buffer, mimeType, fileName } = await renderReportBuffer(creatorContext, {
        reportType: report.reportType,
        format: report.exportFormat,
        filters: (report.filters ?? {}) as Record<string, unknown>,
      });

      const mailProvider = getMailProvider();
      const results = await Promise.all(
        report.recipientEmails.map((to) =>
          mailProvider.send({
            to,
            subject: `Scheduled report: ${report.name}`,
            body: `Your scheduled report "${report.name}" ran on ${now.toISOString()}.`,
            attachments: [{ fileName, contentType: mimeType, content: buffer }],
          }),
        ),
      );
      const allSucceeded = results.every((result) => result.success);

      await prisma.savedReport.update({
        where: { id: report.id },
        data: { lastRunAt: now, lastRunStatus: allSucceeded ? "SENT" : "FAILED" },
      });
      await recordAudit({
        actorId: report.createdById,
        action: AUDIT_ACTIONS.SAVED_REPORT_SCHEDULE_RUN,
        entityType: ENTITY.SAVED_REPORT,
        entityId: report.id,
        changes: { after: { status: allSucceeded ? "SENT" : "FAILED", recipientCount: report.recipientEmails.length } },
      });
      if (allSucceeded) sentCount += 1;
      else failedCount += 1;
    } catch {
      await prisma.savedReport.update({ where: { id: report.id }, data: { lastRunAt: now, lastRunStatus: "FAILED" } });
      failedCount += 1;
    }
  }

  return { dueCount: due.length, sentCount, failedCount };
}
