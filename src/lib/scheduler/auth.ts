import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The scheduler endpoint (POST /api/scheduler/run) is called by external
 * infrastructure with no user session to resolve (Vercel Cron, AWS
 * EventBridge, a Railway/Render cron job, a Kubernetes CronJob, Windows
 * Task Scheduler...) — `withApiHandler`'s unconditional session requirement
 * (src/lib/api/handlers.ts) genuinely does not apply here, and this is the
 * one deliberate exception to it in this codebase, not a general new route
 * class. Authentication is a shared secret (`SCHEDULER_SECRET`, an
 * environment variable never exposed to client code — see docs/api.md for
 * how to configure each infrastructure provider to send it) presented as
 * `Authorization: Bearer <secret>`, matching Vercel Cron's own documented
 * convention for its `CRON_SECRET` (an HTTP header, not a query string,
 * since query strings routinely end up in access logs and proxy caches).
 *
 * Hashing both sides to a fixed-length digest before comparing means the
 * comparison never branches on the raw secret's length — a plain
 * `timingSafeEqual(a, b)` throws on a length mismatch, which is itself an
 * observable (if crude) timing signal an attacker could use to fish for the
 * secret's length before brute-forcing its content.
 */
export function isValidSchedulerSecret(providedSecret: string | null): boolean {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected || !providedSecret) {
    return false;
  }
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(providedSecret).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

/** Extracts the bearer token from an `Authorization: Bearer <secret>` header, or null. */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}
