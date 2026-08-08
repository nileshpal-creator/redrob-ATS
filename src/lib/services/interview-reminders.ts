import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY } from "@/lib/entity-registry";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { getMailProvider } from "@/lib/mail";
import { renderTemplate } from "@/lib/templates/render";

const MINUTE_MS = 60_000;

/**
 * §11.5: "Automatic email reminders to candidate and panel at configurable
 * intervals." No cron/queue infrastructure exists anywhere in this app —
 * this function is the real business logic; POST /api/scheduler/run is
 * what an external scheduler calls to invoke it periodically (see
 * src/lib/scheduler/run.ts). Bounded per call on two axes: at most
 * MAX_INTERVIEWS_PER_RUN interviews are considered, and at most
 * MAX_REMINDERS_PER_RUN individual (candidate/panelist) sends are attempted
 * — a large due backlog is worked off over several scheduler ticks rather
 * than in one unbounded pass.
 */
const MAX_INTERVIEWS_PER_RUN = 200;
const MAX_REMINDERS_PER_RUN = 500;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MINUTES = 5;
// A claim (status PROCESSING) older than this is treated as abandoned —
// the process that made it crashed or timed out mid-send — and becomes
// reclaimable by a later run, the same "must not rely on the claim forever"
// requirement claimExecutionSlot's own idempotency satisfies via a single
// atomic insert; here the claim is a status, so recovery needs its own
// staleness window instead.
const STALE_PROCESSING_MINUTES = 10;

const CANDIDATE_REMINDER_TEMPLATE_NAME = "Interview Reminder — Candidate";
const PANELIST_REMINDER_TEMPLATE_NAME = "Interview Reminder — Panelist";

function leadTimeLabel(leadMinutes: number): string {
  if (leadMinutes % (24 * 60) === 0) {
    const days = leadMinutes / (24 * 60);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (leadMinutes % 60 === 0) {
    const hours = leadMinutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${leadMinutes} minutes`;
}

type ReminderRecipient = {
  recipientType: "CANDIDATE" | "PANELIST";
  recipientId: string;
  toEmail: string | null;
  templateName: string;
  templateContext: Record<string, string>;
};

type InterviewForReminder = {
  id: string;
  scheduledAt: Date;
  roundName: string;
  application: {
    candidate: { id: string; name: string; email: string | null };
    job: { title: string };
  };
  panelists: { user: { id: string; name: string; email: string | null; isActive: boolean } }[];
};

function buildRecipients(interview: InterviewForReminder, leadMinutes: number): ReminderRecipient[] {
  const sharedContext = {
    "candidate.name": interview.application.candidate.name,
    "job.title": interview.application.job.title,
    "interview.roundName": interview.roundName,
    "interview.scheduledAt": interview.scheduledAt.toISOString(),
    "reminder.leadTime": leadTimeLabel(leadMinutes),
  };

  const recipients: ReminderRecipient[] = [
    {
      recipientType: "CANDIDATE",
      recipientId: "candidate",
      toEmail: interview.application.candidate.email,
      templateName: CANDIDATE_REMINDER_TEMPLATE_NAME,
      templateContext: sharedContext,
    },
  ];

  for (const panelist of interview.panelists) {
    if (!panelist.user.isActive) continue;
    recipients.push({
      recipientType: "PANELIST",
      recipientId: panelist.user.id,
      toEmail: panelist.user.email,
      templateName: PANELIST_REMINDER_TEMPLATE_NAME,
      templateContext: { ...sharedContext, "panelist.name": panelist.user.name },
    });
  }

  return recipients;
}

/**
 * One recipient's reminder for one (interview, lead time). The `create`
 * call IS the claim on a first-ever attempt — a concurrent duplicate
 * `create` fails on the unique constraint (P2002), not a silent double
 * send. Reclaiming an *existing* row for a retry (or recovering a stale
 * abandoned claim) uses a status-guarded `updateMany`, the same
 * "transition the status itself, not just a counter, so a second
 * concurrent racer's identical WHERE clause stops matching" pattern
 * removeJobPosting/completeWorkflowTask already establish — incrementing
 * `attempts` alone would NOT be exclusive, since two concurrent updateMany
 * calls with an unchanged status in the WHERE clause could both match.
 */
async function claimReminderSlot(
  interviewId: string,
  scheduledAtFingerprint: string,
  leadMinutes: number,
  recipient: ReminderRecipient,
  now: Date,
): Promise<{ id: string; attempts: number } | null> {
  const created = await prisma.interviewReminder
    .create({
      data: {
        interviewId,
        scheduledAtFingerprint,
        leadMinutes,
        recipientType: recipient.recipientType,
        recipientId: recipient.recipientId,
        toEmail: recipient.toEmail,
        status: "PROCESSING",
        attempts: 1,
      },
      select: { id: true, attempts: true },
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return null;
      }
      throw error;
    });
  if (created) return created;

  const existing = await prisma.interviewReminder.findUnique({
    where: {
      interviewId_scheduledAtFingerprint_leadMinutes_recipientId: {
        interviewId,
        scheduledAtFingerprint,
        leadMinutes,
        recipientId: recipient.recipientId,
      },
    },
  });
  if (!existing || existing.status === "SENT" || existing.status === "FAILED") {
    return null;
  }

  const staleCutoff = new Date(now.getTime() - STALE_PROCESSING_MINUTES * MINUTE_MS);
  const claim = await prisma.interviewReminder.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: "RETRYING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", updatedAt: { lt: staleCutoff } },
      ],
    },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
  if (claim.count === 0) return null;

  const reclaimed = await prisma.interviewReminder.findUniqueOrThrow({ where: { id: existing.id } });
  return { id: reclaimed.id, attempts: reclaimed.attempts };
}

async function finalizeMissingEmail(reminderId: string) {
  await prisma.interviewReminder.update({
    where: { id: reminderId },
    data: { status: "FAILED", lastError: "No email on file for this recipient." },
  });
}

async function finalizeSend(reminderId: string, attempts: number, now: Date, result: { success: boolean; errorMessage?: string }) {
  if (result.success) {
    await prisma.interviewReminder.update({
      where: { id: reminderId },
      data: { status: "SENT", sentAt: now, lastError: null },
    });
    return "sent" as const;
  }

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.interviewReminder.update({
      where: { id: reminderId },
      data: { status: "FAILED", lastError: result.errorMessage ?? "Send failed." },
    });
    return "failed" as const;
  }

  const backoffMinutes = BASE_BACKOFF_MINUTES * 2 ** (attempts - 1);
  await prisma.interviewReminder.update({
    where: { id: reminderId },
    data: {
      status: "RETRYING",
      nextAttemptAt: new Date(now.getTime() + backoffMinutes * MINUTE_MS),
      lastError: result.errorMessage ?? "Send failed.",
    },
  });
  return "retrying" as const;
}

type ReminderTemplate = { subject: string; body: string };

async function sendOneReminder(
  interviewId: string,
  scheduledAtFingerprint: string,
  leadMinutes: number,
  recipient: ReminderRecipient,
  now: Date,
  templatesByName: Map<string, ReminderTemplate>,
): Promise<"sent" | "retrying" | "failed" | "skipped"> {
  const claimed = await claimReminderSlot(interviewId, scheduledAtFingerprint, leadMinutes, recipient, now);
  if (!claimed) return "skipped";

  if (!recipient.toEmail) {
    await finalizeMissingEmail(claimed.id);
    return "failed";
  }

  // Fetched once per run (see runDueInterviewReminders), not per recipient
  // — there are only ever two distinct template names, however many
  // reminders are being sent this tick.
  const template = templatesByName.get(recipient.templateName);

  // Outside any transaction — never hold a DB write open while waiting on
  // an external mail provider (requirement #2). Claim above and finalize
  // below are separate, independent statements.
  const result = template
    ? await getMailProvider().send({
        to: recipient.toEmail,
        subject: renderTemplate(template.subject, recipient.templateContext),
        body: renderTemplate(template.body, recipient.templateContext),
      })
    : { success: false, errorMessage: "Interview reminder template not configured." };

  const outcome = await finalizeSend(claimed.id, claimed.attempts, now, result);

  await recordAudit({
    actorId: null,
    action: outcome === "sent" ? AUDIT_ACTIONS.INTERVIEW_REMINDER_SENT : AUDIT_ACTIONS.INTERVIEW_REMINDER_FAILED,
    entityType: ENTITY.INTERVIEW,
    entityId: interviewId,
    changes: {
      after: {
        leadMinutes,
        recipientType: recipient.recipientType,
        outcome,
        attempts: claimed.attempts,
        errorMessage: result.success ? undefined : result.errorMessage,
      },
    },
  });

  return outcome;
}

const interviewForReminderInclude = {
  application: {
    select: {
      candidate: { select: { id: true, name: true, email: true } },
      job: { select: { title: true } },
    },
  },
  panelists: { select: { user: { select: { id: true, name: true, email: true, isActive: true } } } },
} satisfies Prisma.InterviewInclude;

/**
 * Finds every SCHEDULED interview with at least one configured lead time
 * currently due, and attempts the candidate + each active panelist's
 * reminder for it. Rescheduling an interview changes `scheduledAt`, which
 * changes `scheduledAtFingerprint` — prior reminder rows for the old time
 * are simply never revisited (this query only ever computes due-ness
 * against the *current* scheduledAt), and a fresh reminder becomes
 * claimable for the new time with no explicit invalidation step, the same
 * "leaving and re-entering a stage produces a fresh fingerprint"
 * TIME_IN_STAGE pattern. Cancelling/completing an interview removes it from
 * this query's `status: "SCHEDULED"` filter entirely — no reminder is ever
 * attempted for it again, whatever partial progress existed before.
 */
export async function runDueInterviewReminders(
  now: Date = new Date(),
  // Test-only override of the batch caps (same "default param overridable
  // for testability" shape `now` itself already has) — exercising the real
  // MAX_INTERVIEWS_PER_RUN/MAX_REMINDERS_PER_RUN caps would otherwise
  // require creating hundreds of real interview rows per test.
  limits: { maxInterviews?: number; maxReminders?: number } = {},
): Promise<{
  interviewsEvaluated: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
}> {
  const maxInterviews = limits.maxInterviews ?? MAX_INTERVIEWS_PER_RUN;
  const maxReminders = limits.maxReminders ?? MAX_REMINDERS_PER_RUN;

  const organization = await prisma.organization.findFirst({ select: { interviewReminderLeadMinutes: true } });
  const leadMinutesList = organization?.interviewReminderLeadMinutes ?? [];
  if (leadMinutesList.length === 0) {
    return { interviewsEvaluated: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  }

  const maxLeadMinutes = Math.max(...leadMinutesList);

  const templateRows = await prisma.communicationTemplate.findMany({
    where: { name: { in: [CANDIDATE_REMINDER_TEMPLATE_NAME, PANELIST_REMINDER_TEMPLATE_NAME] }, isActive: true },
    select: { name: true, subject: true, body: true },
  });
  const templatesByName = new Map(templateRows.map((row) => [row.name, { subject: row.subject, body: row.body }]));

  const interviews = await prisma.interview.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { gt: now, lte: new Date(now.getTime() + maxLeadMinutes * MINUTE_MS) },
    },
    include: interviewForReminderInclude,
    orderBy: { scheduledAt: "asc" },
    take: maxInterviews,
  });

  let sent = 0;
  let retrying = 0;
  let failed = 0;
  let skipped = 0;
  let remindersAttempted = 0;

  for (const interview of interviews) {
    if (remindersAttempted >= maxReminders) break;

    const fingerprint = interview.scheduledAt.toISOString();
    for (const leadMinutes of leadMinutesList) {
      const dueAt = new Date(interview.scheduledAt.getTime() - leadMinutes * MINUTE_MS);
      if (dueAt > now) continue;

      const recipients = buildRecipients(interview, leadMinutes);
      for (const recipient of recipients) {
        if (remindersAttempted >= maxReminders) break;
        remindersAttempted += 1;

        // Isolated per recipient — one bad recipient (missing template,
        // unexpected error) must never block the rest of this run.
        try {
          const outcome = await sendOneReminder(interview.id, fingerprint, leadMinutes, recipient, now, templatesByName);
          if (outcome === "sent") sent += 1;
          else if (outcome === "retrying") retrying += 1;
          else if (outcome === "failed") failed += 1;
          else skipped += 1;
        } catch (error) {
          console.error("Interview reminder attempt failed unexpectedly:", error);
          failed += 1;
        }
      }
    }
  }

  return { interviewsEvaluated: interviews.length, sent, retrying, failed, skipped };
}
