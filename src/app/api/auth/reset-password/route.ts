import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api/handlers";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { confirmPasswordReset } from "@/lib/services/password-reset";

/** Public, same reasoning as /api/auth/forgot-password — the caller has no session yet. */
export async function POST(request: Request) {
  try {
    const input = resetPasswordSchema.parse(await request.json());
    await confirmPasswordReset(input.token, input.newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
