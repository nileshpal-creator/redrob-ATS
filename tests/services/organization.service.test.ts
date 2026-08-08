import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { getOrganizationSettings, updateOrganizationSettings } from "@/lib/services/organization";

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

describe("OrganizationService", () => {
  let adminRoleId: string;
  let readOnlyRoleId: string;
  let noAccessRoleId: string;

  let admin: SessionContext;
  let readOnly: SessionContext;
  let noAccessUser: SessionContext;

  // The test DB is migration-only (no prisma/seed.ts run), so there is
  // normally no Organization row here at all. This describe block is the
  // one place that creates it if missing — and, critically, must delete it
  // again in afterAll in that case: leaving a stray row behind would give
  // another test file's own `prisma.organization.findFirst()` a second,
  // non-deterministically-ordered row to pick from (see
  // tests/services/interview-reminders.service.test.ts, which assumes it's
  // the only row in the table).
  let organizationId: string;
  let originalLeadMinutes: number[];
  let originalThresholdDays: number;
  let organizationPreExisted: boolean;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const adminRole = await prisma.role.create({
      data: {
        name: "Test Org Admin",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "ORGANIZATION", action: "READ", scope: "ALL" },
              { resource: "ORGANIZATION", action: "UPDATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    adminRoleId = adminRole.id;

    const readOnlyRole = await prisma.role.create({
      data: {
        name: "Test Org Read Only",
        rolePermissions: { createMany: { data: [{ resource: "ORGANIZATION", action: "READ", scope: "ALL" }] } },
      },
    });
    readOnlyRoleId = readOnlyRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Org No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [adminUser, readOnlyUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Org Admin", email: "org-admin@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Org Read Only", email: "org-readonly@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Org No Access", email: "org-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRoleId },
        { userId: readOnlyUser.id, roleId: readOnlyRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    admin = contextFor({ ...adminUser, roles: [{ id: adminRoleId, name: "Test Org Admin", isSuperAdmin: false }] });
    readOnly = contextFor({
      ...readOnlyUser,
      roles: [{ id: readOnlyRoleId, name: "Test Org Read Only", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Org No Access", isSuperAdmin: false }],
    });

    const existing = await prisma.organization.findFirst();
    organizationPreExisted = existing !== null;
    if (existing) {
      organizationId = existing.id;
      originalLeadMinutes = existing.interviewReminderLeadMinutes;
      originalThresholdDays = existing.offerTatThresholdDays;
    } else {
      const created = await prisma.organization.create({ data: { name: "Test Org" } });
      organizationId = created.id;
      originalLeadMinutes = created.interviewReminderLeadMinutes;
      originalThresholdDays = created.offerTatThresholdDays;
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "ORGANIZATION", entityId: organizationId } });
    if (organizationPreExisted) {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { interviewReminderLeadMinutes: originalLeadMinutes, offerTatThresholdDays: originalThresholdDays },
      });
    } else {
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.userRole.deleteMany({ where: { roleId: { in: [adminRoleId, readOnlyRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["org-admin@test.local", "org-readonly@test.local", "org-noaccess@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [adminRoleId, readOnlyRoleId, noAccessRoleId] } } });
  });

  describe("getOrganizationSettings", () => {
    it("returns the singleton row for a caller with ORGANIZATION:READ", async () => {
      const settings = await getOrganizationSettings(readOnly);
      expect(settings.id).toBe(organizationId);
    });

    it("throws ForbiddenError for a caller with no ORGANIZATION grant", async () => {
      await expect(getOrganizationSettings(noAccessUser)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("updateOrganizationSettings", () => {
    it("updates only offerTatThresholdDays, leaving interviewReminderLeadMinutes untouched", async () => {
      await updateOrganizationSettings(admin, { interviewReminderLeadMinutes: [60, 1440] });

      const updated = await updateOrganizationSettings(admin, { offerTatThresholdDays: 7 });
      expect(updated.offerTatThresholdDays).toBe(7);
      expect(updated.interviewReminderLeadMinutes).toEqual([60, 1440]);
    });

    it("updates only interviewReminderLeadMinutes, leaving offerTatThresholdDays untouched", async () => {
      await updateOrganizationSettings(admin, { offerTatThresholdDays: 4 });

      const updated = await updateOrganizationSettings(admin, { interviewReminderLeadMinutes: [30] });
      expect(updated.interviewReminderLeadMinutes).toEqual([30]);
      expect(updated.offerTatThresholdDays).toBe(4);
    });

    it("records an audit log entry with before/after for both settings", async () => {
      await updateOrganizationSettings(admin, { offerTatThresholdDays: 2, interviewReminderLeadMinutes: [15] });
      const updated = await updateOrganizationSettings(admin, { offerTatThresholdDays: 9 });
      expect(updated.offerTatThresholdDays).toBe(9);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "ORGANIZATION", entityId: organizationId, action: "organization.settings_updated" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry).not.toBeNull();
      const changes = entry?.changes as { before: { offerTatThresholdDays: number }; after: { offerTatThresholdDays: number } };
      expect(changes.before.offerTatThresholdDays).toBe(2);
      expect(changes.after.offerTatThresholdDays).toBe(9);
    });

    it("throws ForbiddenError for a caller without ORGANIZATION:UPDATE", async () => {
      await expect(updateOrganizationSettings(readOnly, { offerTatThresholdDays: 5 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(updateOrganizationSettings(noAccessUser, { offerTatThresholdDays: 5 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });
});
