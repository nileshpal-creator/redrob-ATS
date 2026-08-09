import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import { confirmPasswordReset, requestPasswordReset } from "@/lib/services/password-reset";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

describe("PasswordResetService", () => {
  const email = "reset-flow-user@test.local";
  let userId: string;

  beforeEach(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { user: { email } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "USER" } });
    await prisma.user.deleteMany({ where: { email } });

    const passwordHash = await bcrypt.hash("OriginalPassw0rd!", 4);
    const user = await prisma.user.create({
      data: { name: "Reset Flow User", email, passwordHash },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { user: { email } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "USER" } });
    await prisma.user.deleteMany({ where: { email } });
  });

  describe("requestPasswordReset", () => {
    it("creates a token row storing only the hash, never the raw token", async () => {
      await requestPasswordReset(email);

      const tokens = await prisma.passwordResetToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].tokenHash).toHaveLength(64); // sha256 hex digest length
      expect(tokens[0].usedAt).toBeNull();
    });

    it("sets an expiry roughly one hour out", async () => {
      const now = new Date("2026-01-01T00:00:00.000Z");
      await requestPasswordReset(email, now);

      const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
      expect(token.expiresAt.getTime() - now.getTime()).toBe(60 * 60 * 1000);
    });

    it("silently no-ops for an email with no matching account (no enumeration)", async () => {
      await expect(requestPasswordReset("no-such-account@test.local")).resolves.toBeUndefined();
      const tokens = await prisma.passwordResetToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(0);
    });

    it("silently no-ops for a deactivated account", async () => {
      await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
      await requestPasswordReset(email);
      const tokens = await prisma.passwordResetToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(0);
    });

    it("invalidates a previous outstanding token when a new one is requested", async () => {
      await requestPasswordReset(email);
      const [firstToken] = await prisma.passwordResetToken.findMany({ where: { userId } });

      await requestPasswordReset(email);

      const refreshedFirst = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: firstToken.id } });
      expect(refreshedFirst.usedAt).not.toBeNull();

      const activeTokens = await prisma.passwordResetToken.findMany({ where: { userId, usedAt: null } });
      expect(activeTokens).toHaveLength(1);
    });
  });

  describe("confirmPasswordReset", () => {
    async function issueRawToken(now?: Date) {
      // requestPasswordReset never returns the raw token (it only emails it),
      // so tests that need one insert a PasswordResetToken row directly,
      // exactly like the service itself would (hash only, raw token kept
      // out of the database).
      const rawToken = "test-raw-token-0123456789abcdef";
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash: hashToken(rawToken),
          expiresAt: now ?? new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      return rawToken;
    }

    it("throws ValidationError for an unknown token", async () => {
      await expect(confirmPasswordReset("not-a-real-token", "NewPassw0rd!")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("throws ValidationError for an expired token and leaves the password unchanged", async () => {
      const rawToken = await issueRawToken(new Date(Date.now() - 1000));

      await expect(confirmPasswordReset(rawToken, "NewPassw0rd!")).rejects.toBeInstanceOf(ValidationError);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(await bcrypt.compare("OriginalPassw0rd!", user.passwordHash)).toBe(true);
    });

    it("resets the password, marks the token used, and records an audit log entry", async () => {
      const rawToken = await issueRawToken();

      await confirmPasswordReset(rawToken, "BrandNewPassw0rd!");

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(await bcrypt.compare("BrandNewPassw0rd!", user.passwordHash)).toBe(true);

      const token = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashToken(rawToken) } });
      expect(token.usedAt).not.toBeNull();

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "USER", entityId: userId, action: "user.password_reset" },
      });
      expect(entry).not.toBeNull();
    });

    it("rejects reusing an already-redeemed token", async () => {
      const rawToken = await issueRawToken();
      await confirmPasswordReset(rawToken, "FirstNewPassw0rd!");

      await expect(confirmPasswordReset(rawToken, "SecondNewPassw0rd!")).rejects.toBeInstanceOf(ValidationError);
    });

    it("only lets one of two concurrent redemptions of the same token succeed", async () => {
      const rawToken = await issueRawToken();

      const results = await Promise.allSettled([
        confirmPasswordReset(rawToken, "ConcurrentPassA1!"),
        confirmPasswordReset(rawToken, "ConcurrentPassB1!"),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });
});
