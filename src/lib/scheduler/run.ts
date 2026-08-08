import { runDueInterviewReminders } from "@/lib/services/interview-reminders";
import { runDueOfferExpirations } from "@/lib/services/offer-expiry";
import { runDueScheduledReports } from "@/lib/services/scheduled-reports";
import { runDueTimeInStageWorkflows } from "@/lib/services/workflows";

type ConsumerResult = {
  name: string;
  success: boolean;
  stats?: unknown;
  error?: string;
  durationMs: number;
};

export type SchedulerRunResult = {
  startedAt: string;
  durationMs: number;
  consumers: ConsumerResult[];
};

/**
 * The one orchestrator every scheduler-triggered path goes through:
 *
 *   External Scheduler → POST /api/scheduler/run → runScheduledWork() →
 *     runDueInterviewReminders / runDueScheduledReports /
 *     runDueTimeInStageWorkflows / runDueOfferExpirations
 *
 * Deliberately not a generic polymorphic job-queue table — the four
 * consumers' own due-detection differs enough (a fixed lead time before an
 * absolute instant, a daily/weekly cadence against a last-run timestamp, a
 * stage-age threshold, a per-offer response deadline) that forcing them
 * into one shared "ScheduledJob" row shape would only be a paraphrase of
 * what each already does well on its own, not a simplification. This
 * function's only job is invocation, isolation, and reporting — each
 * consumer owns its own idempotency, batching, and retry logic (see their
 * own files).
 *
 * Consumers run concurrently (they touch disjoint tables, so there is no
 * ordering requirement between them) and are individually isolated: one
 * consumer throwing never prevents the others from running or being
 * reported on — "partial failure does not prevent later jobs."
 */
export async function runScheduledWork(
  now: Date = new Date(),
  // Test-only consumer overrides (same "default param overridable for
  // testability" shape `now` already has) — lets a test make one consumer
  // throw deterministically and verify the other two still ran and were
  // reported on, without mocking a module.
  consumerOverrides: {
    interviewReminders?: (now: Date) => Promise<unknown>;
    scheduledReports?: (now: Date) => Promise<unknown>;
    timeInStageWorkflows?: (now: Date) => Promise<unknown>;
    offerExpirations?: (now: Date) => Promise<unknown>;
  } = {},
): Promise<SchedulerRunResult> {
  const start = Date.now();
  const interviewReminders = consumerOverrides.interviewReminders ?? runDueInterviewReminders;
  const scheduledReports = consumerOverrides.scheduledReports ?? runDueScheduledReports;
  const timeInStageWorkflows = consumerOverrides.timeInStageWorkflows ?? runDueTimeInStageWorkflows;
  const offerExpirations = consumerOverrides.offerExpirations ?? runDueOfferExpirations;

  async function runConsumer(name: string, fn: () => Promise<unknown>): Promise<ConsumerResult> {
    const consumerStart = Date.now();
    try {
      const stats = await fn();
      return { name, success: true, stats, durationMs: Date.now() - consumerStart };
    } catch (error) {
      // Never log message bodies/attachment contents — only the error's own
      // message, matching what every other service in this app already
      // logs on an unexpected failure.
      console.error(`Scheduler consumer "${name}" failed:`, error);
      return {
        name,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - consumerStart,
      };
    }
  }

  const consumers = await Promise.all([
    runConsumer("interview-reminders", () => interviewReminders(now)),
    runConsumer("scheduled-reports", () => scheduledReports(now)),
    runConsumer("time-in-stage-workflows", () => timeInStageWorkflows(now)),
    runConsumer("offer-expirations", () => offerExpirations(now)),
  ]);

  return {
    startedAt: new Date(start).toISOString(),
    durationMs: Date.now() - start,
    consumers,
  };
}
