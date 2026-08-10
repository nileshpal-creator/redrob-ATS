import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The scheduler endpoint (GET/POST /api/scheduler/run) is called by external
 * infrastructure with no user session to resolve (Vercel Cron, AWS
 * EventBridge, a Railway/Render cron job, a Kubernetes CronJob, Windows
 * Task Scheduler...) — `withApiHandler`'s unconditional session requirement
 * (src/lib/api/handlers.ts) genuinely does not apply here, and this is the
 * one deliberate exception to it in this codebase, not a general new route
 * class. Authentication is a shared secret presented as
 * `Authorization: Bearer <secret>` (an HTTP header, not a query string,
 * since query strings routinely end up in access logs and proxy caches).
 *
 * Two accepted secrets, either one sufficient: `SCHEDULER_SECRET` (this
 * app's own name, for any caller that lets you set an arbitrary header —
 * AWS EventBridge, Railway/Render, a plain crontab, etc. — see docs/api.md)
 * and `CRON_SECRET` (Vercel's own reserved env var name for its native Cron
 * Jobs feature, which sends it verbatim as the bearer token — Vercel Cron
 * doesn't let you name your own env var or header value, so this app has to
 * accept Vercel's name specifically to support it, not just its own).
 *
 * Hashing both sides to a fixed-length digest before comparing means the
 * comparison never branches on the raw secret's length — a plain
 * `timingSafeEqual(a, b)` throws on a length mismatch, which is itself an
 * observable (if crude) timing signal an attacker could use to fish for the
 * secret's length before brute-forcing its content.
 */
export function isValidSchedulerSecret(providedSecret: string | null): boolean {
  if (!providedSecret) {
    return false;
  }
  const providedDigest = createHash("sha256").update(providedSecret).digest();

  return [process.env.SCHEDULER_SECRET, process.env.CRON_SECRET]
    .filter((secret): secret is string => Boolean(secret))
    .some((expected) => timingSafeEqual(createHash("sha256").update(expected).digest(), providedDigest));
}

/** Extracts the bearer token from an `Authorization: Bearer <secret>` header, or null. */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}
