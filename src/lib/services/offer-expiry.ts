import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

/**
 * §11.6 auto-expiry consumer, wired into the Module 12 scheduler orchestrator
 * (src/lib/scheduler/run.ts) alongside runDueInterviewReminders/
 * runDueScheduledReports/runDueTimeInStageWorkflows — reuses that
 * infrastructure rather than inventing a second cron system.
 *
 * No claim-execution-slot state machine here (unlike
 * runDueTimeInStageWorkflows/InterviewReminder): those exist because their
 * consumers drive an external, retry-prone side effect (a workflow action,
 * an email send) that must never double-fire for the same due event across
 * overlapping scheduler runs. This consumer only flips one already-terminal-
 * bound status via the same version-guarded `updateMany` every other Offer
 * transition uses — a second concurrent run simply finds `result.count === 0`
 * for any offer the first run already claimed and moves on, so idempotency
 * falls out of the existing optimistic-lock pattern for free.
 */
export async function runDueOfferExpirations(
  now: Date = new Date(),
): Promise<{ evaluatedCount: number; lapsedCount: number }> {
  const dueOffers = await prisma.offer.findMany({
    where: { status: "EXTENDED", respondByDate: { lte: now } },
    select: { id: true, version: true },
  });

  let lapsedCount = 0;
  for (const offer of dueOffers) {
    const result = await prisma.offer.updateMany({
      where: { id: offer.id, version: offer.version, status: "EXTENDED" },
      data: { status: "LAPSED", version: { increment: 1 } },
    });
    if (result.count === 0) continue;

    lapsedCount += 1;
    await recordAudit({
      actorId: null,
      action: AUDIT_ACTIONS.OFFER_LAPSED,
      entityType: ENTITY.OFFER,
      entityId: offer.id,
      changes: { before: { status: "EXTENDED" }, after: { status: "LAPSED" } },
    });
  }

  return { evaluatedCount: dueOffers.length, lapsedCount };
}
