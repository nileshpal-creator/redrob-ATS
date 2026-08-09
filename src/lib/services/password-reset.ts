import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { getMailProvider } from "@/lib/mail";
import { ValidationError } from "@/lib/errors";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/**
 * Always resolves the same way whether or not the email belongs to an
 * account — the caller (the API route) returns one generic "if an account
 * exists, we've emailed it" response regardless, so this endpoint can't be
 * used to enumerate registered emails via a different status code/timing.
 *
 * A raw token is emailed to the user and never stored — only its SHA-256
 * hash is (same "never persist the actual secret" idiom as the scheduler's
 * bearer-token check, src/lib/scheduler/auth.ts) — so a database read alone
 * can't produce a usable reset link.
 */
export async function requestPasswordReset(email: string, now: Date = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return;
  }

  // Invalidate any still-outstanding links from earlier requests first, so
  // an old email sitting in an inbox can't still be redeemed once a newer
  // one has been issued.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  });

  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
  });

  const resetUrl = `${appUrl()}/reset-password?token=${rawToken}`;
  await getMailProvider().send({
    to: user.email,
    subject: "Reset your Redrob ATS password",
    body:
      `Hi ${user.name},\n\n` +
      "We received a request to reset your password. This link expires in 1 hour:\n\n" +
      `${resetUrl}\n\n` +
      "If you didn't request this, you can safely ignore this email — your password won't change.",
  });
}

/**
 * Redeems a reset token: validates it's unexpired and unused, atomically
 * claims it (an `updateMany` guarded on `usedAt: null`, the same
 * claim-then-check-count shape `runDueOfferExpirations` uses for its
 * version-guarded update) so two concurrent redemptions of the same link
 * can't both succeed, then sets the new password.
 */
export async function confirmPasswordReset(
  rawToken: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<void> {
  const invalidMessage = "This password reset link is invalid or has expired.";
  const tokenHash = hashToken(rawToken);

  const candidate = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!candidate || candidate.usedAt || candidate.expiresAt <= now) {
    throw new ValidationError(invalidMessage);
  }

  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: candidate.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) {
    throw new ValidationError(invalidMessage);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: candidate.userId }, data: { passwordHash } });

  await recordAudit({
    actorId: candidate.userId,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    entityType: ENTITY.USER,
    entityId: candidate.userId,
    changes: {},
  });
}
