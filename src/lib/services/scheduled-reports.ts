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

// Bounds how many due reports one call processes — a large backlog is
// worked off over several scheduler ticks rather than in one unbounded
// pass (Module 12: "avoid running forever" / "unbounded batch processing").
const MAX_REPORTS_PER_RUN = 100;

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
 *
 * Module 12 fix: this used to be a plain check-then-act
 * (findMany → filter isDue → …later… → update(lastRunAt)) — two concurrent
 * calls could both read the same stale `lastRunAt` before either wrote,
 * and both would send the report.
 *
 * The first fix attempt used only `report.version` (already present for
 * the CRUD edit path's own optimistic locking) as the claim, incrementing
 * it atomically before sending. That closes the *same-stale-read* race but
 * not a *later* one: rendering + sending a report is not instant, and
 * `lastRunAt` — the column `isDue` actually reads — was left untouched
 * until after the send finished. A second scheduler tick starting mid-send
 * would do its own fresh `findMany`, see the *already-incremented* version
 * (not stale to *it*) and the still-old `lastRunAt` (still "due" to it),
 * and successfully claim and send a second time. The fix is to stamp
 * `lastRunAt: now` as part of the same atomic claim, not after the send —
 * so any tick that starts once this one has claimed sees a fresh
 * `lastRunAt` and correctly evaluates the report as not-yet-due, for the
 * whole duration of the send, not just for the instant of the claim.
 * (Two callers reading the *identical* stale version simultaneously still
 * can't both win either way — `version` is what that WHERE clause keys on.)
 * A side effect worth noting: this now also means a concurrent *edit* of
 * the report (which bumps the same version) and a scheduler claim can't
 * both win — one loses and, for the edit path, surfaces its own existing
 * ConflictError; that's a correct consequence of sharing the column, not a
 * new bug.
 *
 * Known residual limitation: if the process crashes after the mail
 * provider confirms success but before the finalize `update` below
 * commits, `lastRunStatus` never reaches `SENT` and the row can be claimed
 * and sent again by a later tick — genuine exactly-once delivery to an
 * external system needs a transactional outbox or provider-side
 * idempotency keys, out of scope for this pass. This is an at-least-once,
 * not exactly-once, guarantee.
 */
export async function runDueScheduledReports(now: Date = new Date(), maxReports: number = MAX_REPORTS_PER_RUN) {
  const candidates = await prisma.savedReport.findMany({
    where: { scheduleFrequency: { in: ["DAILY", "WEEKLY"] } },
    // Never-run reports (lastRunAt: null) must not starve behind an
    // already-run backlog if due reports ever exceed maxReports in one
    // tick — Postgres's default NULLS LAST on ASC would otherwise put them
    // last every time.
    orderBy: { lastRunAt: { sort: "asc", nulls: "first" } },
    take: maxReports,
  });

  const due = candidates.filter((report) => isDue(report.scheduleFrequency as "DAILY" | "WEEKLY", report.lastRunAt, now));

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const report of due) {
    const claim = await prisma.savedReport.updateMany({
      where: { id: report.id, version: report.version },
      data: { version: { increment: 1 }, lastRunAt: now },
    });
    if (claim.count === 0) {
      // Lost the race to another concurrent scheduler invocation (or to an
      // unrelated concurrent edit) — skip, not a failure.
      skippedCount += 1;
      continue;
    }

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

  return { dueCount: due.length, sentCount, failedCount, skippedCount };
}
