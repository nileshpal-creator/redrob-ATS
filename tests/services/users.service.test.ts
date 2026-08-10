import { afterAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { changePassword, completeOnboarding, deleteUser, getOwnProfile } from "@/lib/services/users";

function contextFor(user: {
  id: string;
  name: string;
  email: string;
  roles: { id: string; name: string; isSuperAdmin: boolean }[];
}): SessionContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    isSuperAdmin: user.roles.some((role) => role.isSuperAdmin),
  };
}

describe("UsersService", () => {
  let superAdminRoleId: string;
  let deleteGrantRoleId: string;
  let noAccessRoleId: string;

  let superAdminA: { id: string; name: string; email: string };
  let deleteGrantUserRow: { id: string; name: string; email: string };
  let noAccessUserRow: { id: string; name: string; email: string };

  let superAdminAContext: SessionContext;
  let deleteGrantContext: SessionContext;
  let noAccessContext: SessionContext;

  const emails = [
    "delete-super-admin-a@test.local",
    "delete-super-admin-b@test.local",
    "delete-grant-user@test.local",
    "delete-no-access-user@test.local",
    "delete-target-plain@test.local",
    "delete-target-referenced@test.local",
    "change-password-user@test.local",
    "profile-user@test.local",
  ];

  beforeEach(async () => {
    // Each test starts from a clean slate for the rows this file owns, since
    // several tests mutate/delete users — re-seeding per test (rather than
    // once in beforeAll) keeps tests independent of execution order.
    await prisma.auditLog.deleteMany({ where: { entityType: "USER" } });
    await prisma.dashboard.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.userRole.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.role.deleteMany({
      where: { name: { in: ["Test Delete Super Admin", "Test Delete Grant", "Test Delete No Access"] } },
    });

    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const superAdminRole = await prisma.role.create({
      data: { name: "Test Delete Super Admin", isSuperAdmin: true },
    });
    superAdminRoleId = superAdminRole.id;

    const deleteGrantRole = await prisma.role.create({
      data: {
        name: "Test Delete Grant",
        rolePermissions: { createMany: { data: [{ resource: "USER", action: "DELETE", scope: "ALL" }] } },
      },
    });
    deleteGrantRoleId = deleteGrantRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Delete No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [superAdminARow, deleteGrantRow, noAccessRow] = await Promise.all([
      prisma.user.create({ data: { name: "Super Admin A", email: "delete-super-admin-a@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Delete Grant User", email: "delete-grant-user@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "No Access User", email: "delete-no-access-user@test.local", passwordHash } }),
    ]);
    superAdminA = superAdminARow;
    deleteGrantUserRow = deleteGrantRow;
    noAccessUserRow = noAccessRow;

    await prisma.userRole.createMany({
      data: [
        { userId: superAdminA.id, roleId: superAdminRoleId },
        { userId: deleteGrantUserRow.id, roleId: deleteGrantRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    superAdminAContext = contextFor({
      ...superAdminA,
      roles: [{ id: superAdminRoleId, name: "Test Delete Super Admin", isSuperAdmin: true }],
    });
    deleteGrantContext = contextFor({
      ...deleteGrantUserRow,
      roles: [{ id: deleteGrantRoleId, name: "Test Delete Grant", isSuperAdmin: false }],
    });
    noAccessContext = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Delete No Access", isSuperAdmin: false }],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "USER" } });
    await prisma.dashboard.deleteMany({ where: { createdBy: { email: { in: emails } } } });
    await prisma.userRole.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.role.deleteMany({
      where: { name: { in: ["Test Delete Super Admin", "Test Delete Grant", "Test Delete No Access"] } },
    });
  });

  describe("deleteUser", () => {
    it("throws ForbiddenError for a caller with no USER:DELETE grant", async () => {
      await expect(deleteUser(noAccessContext, superAdminA.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ForbiddenError for a caller with a USER:DELETE grant who isn't a super admin", async () => {
      // Deletion is restricted to real super admins regardless of any
      // USER:DELETE grant a custom role might carry — this is the case that
      // distinguishes it from every other RBAC-gated action in the service.
      await expect(deleteUser(deleteGrantContext, superAdminA.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ValidationError when a super admin tries to delete their own account", async () => {
      await expect(deleteUser(superAdminAContext, superAdminA.id)).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws NotFoundError for a nonexistent user id", async () => {
      await expect(deleteUser(superAdminAContext, "nonexistent-user-id")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ValidationError when deleting the last active super admin", async () => {
      // Isolates the "last super admin" guard from the "is the caller a
      // super admin" gate by handing deleteUser a context that *claims*
      // isSuperAdmin so it clears the initial check, while superAdminA is
      // the only user actually flagged isSuperAdmin in the database — the
      // guard's own count query is what must catch this.
      const syntheticSuperAdminContext = contextFor({
        ...deleteGrantUserRow,
        roles: [{ id: deleteGrantRoleId, name: "Test Delete Grant", isSuperAdmin: true }],
      });

      await expect(deleteUser(syntheticSuperAdminContext, superAdminA.id)).rejects.toBeInstanceOf(ValidationError);

      const stillExists = await prisma.user.findUnique({ where: { id: superAdminA.id } });
      expect(stillExists).not.toBeNull();
    });

    it("does not block deleting a super admin when another active super admin remains", async () => {
      const passwordHash = await bcrypt.hash("Test123!Test123!", 4);
      const superAdminB = await prisma.user.create({
        data: { name: "Super Admin B", email: "delete-super-admin-b@test.local", passwordHash },
      });
      await prisma.userRole.create({ data: { userId: superAdminB.id, roleId: superAdminRoleId } });

      await deleteUser(superAdminAContext, superAdminB.id);

      const deleted = await prisma.user.findUnique({ where: { id: superAdminB.id } });
      expect(deleted).toBeNull();
    });

    it("throws ValidationError instead of a raw FK error when the user has referencing records", async () => {
      const passwordHash = await bcrypt.hash("Test123!Test123!", 4);
      const referencedUser = await prisma.user.create({
        data: { name: "Referenced User", email: "delete-target-referenced@test.local", passwordHash },
      });
      await prisma.dashboard.create({ data: { name: "Owned dashboard", createdById: referencedUser.id } });

      await expect(deleteUser(superAdminAContext, referencedUser.id)).rejects.toBeInstanceOf(ValidationError);

      const stillExists = await prisma.user.findUnique({ where: { id: referencedUser.id } });
      expect(stillExists).not.toBeNull();
    });

    it("deletes a user with no referencing records and records an audit log entry", async () => {
      const passwordHash = await bcrypt.hash("Test123!Test123!", 4);
      const plainUser = await prisma.user.create({
        data: { name: "Plain Target", email: "delete-target-plain@test.local", passwordHash },
      });

      await deleteUser(superAdminAContext, plainUser.id);

      const deleted = await prisma.user.findUnique({ where: { id: plainUser.id } });
      expect(deleted).toBeNull();

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "USER", entityId: plainUser.id, action: "user.deleted" },
      });
      expect(entry).not.toBeNull();
    });
  });

  describe("changePassword", () => {
    it("throws ValidationError when currentPassword is incorrect", async () => {
      await expect(
        changePassword(superAdminAContext, { currentPassword: "wrong-password", newPassword: "NewPassw0rd!" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("updates the password hash and records an audit log entry when currentPassword is correct", async () => {
      await changePassword(superAdminAContext, {
        currentPassword: "Test123!Test123!",
        newPassword: "BrandNewPassw0rd!",
      });

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: superAdminA.id } });
      expect(await bcrypt.compare("BrandNewPassw0rd!", updated.passwordHash)).toBe(true);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "USER", entityId: superAdminA.id, action: "user.password_changed" },
      });
      expect(entry).not.toBeNull();
    });
  });

  describe("completeOnboarding", () => {
    it("stamps onboardingCompletedAt for the caller, with no RBAC gate", async () => {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: noAccessUserRow.id } });
      expect(before.onboardingCompletedAt).toBeNull();

      await completeOnboarding(noAccessContext);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: noAccessUserRow.id } });
      expect(after.onboardingCompletedAt).not.toBeNull();
    });

    it("does not record an audit log entry — this is a UI preference, not an audited event", async () => {
      await completeOnboarding(superAdminAContext);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "USER", entityId: superAdminA.id, action: { contains: "onboarding" } },
      });
      expect(entry).toBeNull();
    });
  });

  describe("getOwnProfile", () => {
    it("returns the caller's own name, email, and roles", async () => {
      const profile = await getOwnProfile(superAdminAContext);
      expect(profile.id).toBe(superAdminA.id);
      expect(profile.email).toBe("delete-super-admin-a@test.local");
      expect(profile.roles.some((entry) => entry.role.isSuperAdmin)).toBe(true);
    });
  });
});
