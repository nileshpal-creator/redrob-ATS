import { NextResponse } from "next/server";

import { extractBearerToken, isValidSchedulerSecret } from "@/lib/scheduler/auth";
import { runScheduledWork } from "@/lib/scheduler/run";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { ENTITY } from "@/lib/entity-registry";

/**
 * The one HTTP entry point external scheduling infrastructure calls —
 * Vercel Cron, AWS EventBridge, a Railway/Render cron job, a Kubernetes
 * CronJob, Windows Task Scheduler, or a plain `curl` in an OS crontab. This
 * route does not itself run on a schedule — nothing in this Next.js
 * application does (no setInterval/setTimeout process; see
 * docs/architecture.md's Module 12 section for why that would not be real
 * production scheduling). Something outside this process must invoke this
 * endpoint periodically; see docs/api.md for exact configuration per
 * provider.
 *
 * Deliberately NOT built on withApiHandler (src/lib/api/handlers.ts) —
 * every other route in this app requires a signed-in session, which a cron
 * provider fundamentally cannot present. Authentication here is a shared
 * secret instead (see src/lib/scheduler/auth.ts), the one deliberate
 * exception to this app's session-only convention, not a general new
 * unauthenticated route class.
 */
export async function POST(request: Request) {
  const providedSecret = extractBearerToken(request.headers.get("authorization"));
  if (!isValidSchedulerSecret(providedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduledWork();

  await recordAudit({
    actorId: null,
    action: AUDIT_ACTIONS.SCHEDULER_RUN,
    entityType: ENTITY.SCHEDULER,
    entityId: "scheduler",
    changes: {
      after: {
        consumers: result.consumers.map((consumer) => ({
          name: consumer.name,
          success: consumer.success,
          durationMs: consumer.durationMs,
          error: consumer.error,
        })),
        durationMs: result.durationMs,
      },
    },
  });

  return NextResponse.json(result);
}
