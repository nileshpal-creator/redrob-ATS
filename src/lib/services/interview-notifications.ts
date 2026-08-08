import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getMailProvider } from "@/lib/mail";
import { renderTemplate } from "@/lib/templates/render";

/**
 * §11.5: "Reschedule/cancel with reason recorded and all parties notified."
 * Reuses the same MailProvider + CommunicationTemplate + ApplicationEmailLog
 * infrastructure bulkEmailApplications (§11.4/§11.10) already established —
 * no second mail-sending path. Called from updateInterview (reschedule) and
 * cancelInterview *after* their own version-guarded transaction has
 * committed, mirroring "audit after commit": a notification about a
 * transition that didn't actually happen would be worse than one that's a
 * few milliseconds late.
 *
 * Idempotency is inherited, not reimplemented here: updateInterview/
 * cancelInterview's own `updateMany({ where: { version } })` guard already
 * guarantees at most one caller's request can ever succeed for a given
 * transition, so at most one call to this function is ever made per actual
 * reschedule/cancel — there is no separate claim/retry state machine to
 * duplicate what Module 12's InterviewReminder needed for a very different
 * problem (a scheduler retrying the *same* due reminder many times).
 */

const RESCHEDULE_CANDIDATE_TEMPLATE = "Interview Rescheduled — Candidate";
const RESCHEDULE_PANELIST_TEMPLATE = "Interview Rescheduled — Panelist";
const CANCEL_CANDIDATE_TEMPLATE = "Interview Cancelled — Candidate";
const CANCEL_PANELIST_TEMPLATE = "Interview Cancelled — Panelist";

type NotifyRecipient = {
  toEmail: string | null;
  templateName: string;
  templateContext: Record<string, string>;
};

// Kept minimal on purpose — only the one field these functions actually
// need — rather than importing the full SessionContext type and coupling
// this module to authz's shape for no reason.
type SessionContextLike = { userId: string };

const interviewForNotificationInclude = {
  application: {
    select: {
      id: true,
      candidate: { select: { id: true, name: true, email: true } },
      job: { select: { title: true } },
    },
  },
  panelists: { select: { user: { select: { id: true, name: true, email: true, isActive: true } } } },
} satisfies Prisma.InterviewInclude;

function buildRecipients(
  interview: Prisma.InterviewGetPayload<{ include: typeof interviewForNotificationInclude }>,
  candidateTemplateName: string,
  panelistTemplateName: string,
  extraContext: Record<string, string>,
): NotifyRecipient[] {
  const sharedContext: Record<string, string> = {
    "candidate.name": interview.application.candidate.name,
    "job.title": interview.application.job.title,
    "interview.roundName": interview.roundName,
    "interview.scheduledAt": interview.scheduledAt.toISOString(),
    "interview.durationMinutes": String(interview.durationMinutes),
    "interview.mode": interview.mode,
    ...extraContext,
  };

  const recipients: NotifyRecipient[] = [
    { toEmail: interview.application.candidate.email, templateName: candidateTemplateName, templateContext: sharedContext },
  ];

  for (const panelist of interview.panelists) {
    if (!panelist.user.isActive) continue;
    recipients.push({
      toEmail: panelist.user.email,
      templateName: panelistTemplateName,
      templateContext: { ...sharedContext, "panelist.name": panelist.user.name },
    });
  }

  return recipients;
}

async function sendNotifications(
  applicationId: string,
  requestedById: string,
  recipients: NotifyRecipient[],
): Promise<{ sent: number; failed: number; skipped: number }> {
  const templateNames = Array.from(new Set(recipients.map((recipient) => recipient.templateName)));
  const templateRows = await prisma.communicationTemplate.findMany({
    where: { name: { in: templateNames }, isActive: true },
    select: { id: true, name: true, subject: true, body: true },
  });
  const templatesByName = new Map(templateRows.map((row) => [row.name, row]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    // A recipient with no email on file simply never gets a row — the same
    // "skip before creating one" convention bulkEmailApplications already
    // uses — not a failure to log or retry.
    if (!recipient.toEmail) {
      skipped += 1;
      continue;
    }

    const template = templatesByName.get(recipient.templateName);
    if (!template) {
      // Missing template configuration is isolated per recipient — one
      // deactivated/renamed template must never block every other
      // recipient's notification.
      failed += 1;
      continue;
    }

    try {
      const subject = renderTemplate(template.subject, recipient.templateContext);
      const body = renderTemplate(template.body, recipient.templateContext);
      // Outside any transaction — never hold a DB write open while waiting
      // on an external mail provider, same requirement Module 12's
      // scheduler consumers already satisfy.
      const result = await getMailProvider().send({ to: recipient.toEmail, subject, body });

      await prisma.applicationEmailLog.create({
        data: {
          applicationId,
          templateId: template.id,
          toEmail: recipient.toEmail,
          subject,
          body,
          status: result.success ? "SENT" : "FAILED",
          requestedById,
          sentAt: result.success ? new Date() : null,
        },
      });

      if (result.success) sent += 1;
      else failed += 1;
    } catch (error) {
      console.error("Interview change notification failed unexpectedly:", error);
      failed += 1;
    }
  }

  return { sent, failed, skipped };
}

/** Called from updateInterview after a reschedule (scheduledAt/durationMinutes/mode change) has committed. */
export async function notifyInterviewRescheduled(interviewId: string, context: SessionContextLike) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: interviewForNotificationInclude,
  });
  if (!interview) return { sent: 0, failed: 0, skipped: 0 };

  const recipients = buildRecipients(interview, RESCHEDULE_CANDIDATE_TEMPLATE, RESCHEDULE_PANELIST_TEMPLATE, {});
  return sendNotifications(interview.application.id, context.userId, recipients);
}

/** Called from cancelInterview after the cancellation has committed. */
export async function notifyInterviewCancelled(
  interviewId: string,
  context: SessionContextLike,
  cancellationReasonLabel: string,
) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: interviewForNotificationInclude,
  });
  if (!interview) return { sent: 0, failed: 0, skipped: 0 };

  const recipients = buildRecipients(interview, CANCEL_CANDIDATE_TEMPLATE, CANCEL_PANELIST_TEMPLATE, {
    "interview.cancellationReason": cancellationReasonLabel,
  });
  return sendNotifications(interview.application.id, context.userId, recipients);
}
