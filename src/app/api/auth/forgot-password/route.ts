import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api/handlers";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { requestPasswordReset } from "@/lib/services/password-reset";

/**
 * Deliberately not built on withApiHandler (src/lib/api/handlers.ts) — that
 * wrapper requires a signed-in session, and a user requesting a password
 * reset is by definition not signed in. Same "must be reachable
 * unauthenticated" exception as the scheduler's run endpoint, just with a
 * public-input shape instead of a shared secret.
 *
 * Always responds 200 with the same body whether or not the email belongs
 * to an account (`requestPasswordReset` itself no-ops for an unknown/
 * inactive user) — this is what actually prevents the endpoint from being
 * used to enumerate registered emails.
 */
export async function POST(request: Request) {
  try {
    const input = forgotPasswordSchema.parse(await request.json());
    await requestPasswordReset(input.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
