import { describe, expect, it } from "vitest";

import { runScheduledWork } from "@/lib/scheduler/run";

describe("runScheduledWork", () => {
  it("runs all five consumers and reports each one's own stats", async () => {
    const result = await runScheduledWork(new Date(), {
      interviewReminders: async () => ({ interviewsEvaluated: 0, sent: 0 }),
      scheduledReports: async () => ({ dueCount: 0, sentCount: 0 }),
      timeInStageWorkflows: async () => ({ evaluatedCount: 0, firedCount: 0 }),
      offerExpirations: async () => ({ evaluatedCount: 0, lapsedCount: 0 }),
      retentionSweeps: async () => ({ evaluatedCount: 0, anonymizedCount: 0 }),
    });

    expect(result.consumers).toHaveLength(5);
    expect(result.consumers.map((c) => c.name).sort()).toEqual([
      "interview-reminders",
      "offer-expirations",
      "retention-sweeps",
      "scheduled-reports",
      "time-in-stage-workflows",
    ]);
    expect(result.consumers.every((c) => c.success)).toBe(true);
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.startedAt).toBe("string");
  });

  it("isolates one consumer's failure — the other four still run and report success", async () => {
    const result = await runScheduledWork(new Date(), {
      interviewReminders: async () => {
        throw new Error("Simulated interview-reminders crash");
      },
      scheduledReports: async () => ({ dueCount: 0, sentCount: 0 }),
      timeInStageWorkflows: async () => ({ evaluatedCount: 0, firedCount: 0 }),
      offerExpirations: async () => ({ evaluatedCount: 0, lapsedCount: 0 }),
      retentionSweeps: async () => ({ evaluatedCount: 0, anonymizedCount: 0 }),
    });

    const failed = result.consumers.find((c) => c.name === "interview-reminders");
    const others = result.consumers.filter((c) => c.name !== "interview-reminders");

    expect(failed?.success).toBe(false);
    expect(failed?.error).toContain("Simulated interview-reminders crash");
    expect(others.every((c) => c.success)).toBe(true);
  });

  it("reports failures for all five independently when all five throw", async () => {
    const result = await runScheduledWork(new Date(), {
      interviewReminders: async () => {
        throw new Error("a");
      },
      scheduledReports: async () => {
        throw new Error("b");
      },
      timeInStageWorkflows: async () => {
        throw new Error("c");
      },
      offerExpirations: async () => {
        throw new Error("d");
      },
      retentionSweeps: async () => {
        throw new Error("e");
      },
    });

    expect(result.consumers.every((c) => !c.success)).toBe(true);
    // The call itself never throws — a fully-failed run is still a normal,
    // reportable response, not an unhandled exception on the endpoint.
  });

  it("each consumer's own duration is bounded and separately reported", async () => {
    const result = await runScheduledWork(new Date(), {
      interviewReminders: async () => ({}),
      scheduledReports: async () => ({}),
      timeInStageWorkflows: async () => ({}),
      offerExpirations: async () => ({}),
      retentionSweeps: async () => ({}),
    });

    for (const consumer of result.consumers) {
      expect(consumer.durationMs).toBeGreaterThanOrEqual(0);
      expect(consumer.durationMs).toBeLessThan(result.durationMs + 50);
    }
  });
});
