import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  createCommunicationTemplate,
  getActiveCommunicationTemplateOrThrow,
  listCommunicationTemplates,
  updateCommunicationTemplate,
} from "@/lib/services/communication-templates";

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

describe("CommunicationTemplateService", () => {
  let noAccessRoleId: string;
  let adminRoleId: string;

  let noAccessUser: SessionContext;
  let admin: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [noAccessRole, adminRole] = await Promise.all([
      prisma.role.create({ data: { name: "Test Comms No Access" } }), // no grants, by design
      prisma.role.create({ data: { name: "Test Comms Admin", isSuperAdmin: true } }),
    ]);
    noAccessRoleId = noAccessRole.id;
    adminRoleId = adminRole.id;

    const [noAccessUserRow, adminUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Comms No Access", email: "comms-noaccess@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Comms Admin", email: "comms-admin@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
        { userId: adminUserRow.id, roleId: adminRoleId },
      ],
    });

    noAccessUser = contextFor({ ...noAccessUserRow, roles: [{ id: noAccessRoleId, name: "Test Comms No Access", isSuperAdmin: false }] });
    admin = contextFor({ ...adminUserRow, roles: [{ id: adminRoleId, name: "Test Comms Admin", isSuperAdmin: true }] });
  });

  afterAll(async () => {
    await prisma.applicationEmailLog.deleteMany({ where: { requestedById: { in: [noAccessUser.userId, admin.userId] } } });
    await prisma.communicationTemplate.deleteMany({ where: { createdById: admin.userId } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [noAccessRoleId, adminRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["comms-noaccess@test.local", "comms-admin@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [noAccessRoleId, adminRoleId] } } });
  });

  describe("createCommunicationTemplate", () => {
    it("lets a super-admin role create a template with no seeded grant needed", async () => {
      const template = await createCommunicationTemplate(admin, {
        name: `Interview Invite ${Date.now()}`,
        channel: "EMAIL",
        subject: "Update on {{job.title}}",
        body: "Hi {{candidate.name}}",
        isActive: true,
      });

      expect(template.channel).toBe("EMAIL");
      expect(template.isActive).toBe(true);
      expect(template.createdById).toBe(admin.userId);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "COMMUNICATION_TEMPLATE", entityId: template.id },
        select: { action: true },
      });
      expect(entries.map((entry) => entry.action)).toEqual(["communication_template.created"]);

      await prisma.communicationTemplate.delete({ where: { id: template.id } });
    });

    it("blocks a role with no grant and no super-admin flag", async () => {
      await expect(
        createCommunicationTemplate(noAccessUser, {
          name: `Should Fail ${Date.now()}`,
          channel: "EMAIL",
          subject: "x",
          body: "x",
          isActive: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects a duplicate name", async () => {
      const name = `Duplicate Name ${Date.now()}`;
      const first = await createCommunicationTemplate(admin, {
        name,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: true,
      });

      await expect(
        createCommunicationTemplate(admin, { name, channel: "EMAIL", subject: "y", body: "y", isActive: true }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.communicationTemplate.delete({ where: { id: first.id } });
    });

    it("lets only one of two concurrent creates with the same name succeed", async () => {
      // The findUnique pre-check above is a courtesy message, not the real
      // guard — two requests can both pass it before either writes. This
      // proves the unique index on `name` (and the P2002 -> ValidationError
      // conversion) is what actually prevents the race, not just the pre-check.
      const name = `Concurrent Name ${Date.now()}`;
      const input = { name, channel: "EMAIL" as const, subject: "x", body: "x", isActive: true };

      const results = await Promise.allSettled([
        createCommunicationTemplate(admin, input),
        createCommunicationTemplate(admin, input),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError);

      const survivor = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createCommunicationTemplate>>>)
        .value;
      await prisma.communicationTemplate.delete({ where: { id: survivor.id } });
    });
  });

  describe("listCommunicationTemplates", () => {
    it("is readable by any authenticated user, not just an admin", async () => {
      const template = await createCommunicationTemplate(admin, {
        name: `Readable By Anyone ${Date.now()}`,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: true,
      });

      const { readableForNoAccess, readableForAdmin } = {
        readableForNoAccess: await listCommunicationTemplates(noAccessUser, {}),
        readableForAdmin: await listCommunicationTemplates(admin, {}),
      };

      expect(readableForNoAccess.map((row) => row.id)).toContain(template.id);
      expect(readableForAdmin.map((row) => row.id)).toContain(template.id);

      await prisma.communicationTemplate.delete({ where: { id: template.id } });
    });

    it("filters by isActive", async () => {
      const active = await createCommunicationTemplate(admin, {
        name: `Active Filter Test ${Date.now()}`,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: true,
      });
      const inactive = await createCommunicationTemplate(admin, {
        name: `Inactive Filter Test ${Date.now()}`,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: false,
      });

      const activeOnly = await listCommunicationTemplates(admin, { isActive: true });
      const ids = activeOnly.map((row) => row.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(inactive.id);

      await prisma.communicationTemplate.deleteMany({ where: { id: { in: [active.id, inactive.id] } } });
    });
  });

  describe("updateCommunicationTemplate", () => {
    it("updates subject/body/isActive but never name", async () => {
      const template = await createCommunicationTemplate(admin, {
        name: `Update Target ${Date.now()}`,
        channel: "EMAIL",
        subject: "Old subject",
        body: "Old body",
        isActive: true,
      });

      const updated = await updateCommunicationTemplate(admin, template.id, {
        subject: "New subject",
        isActive: false,
      });

      expect(updated.name).toBe(template.name);
      expect(updated.subject).toBe("New subject");
      expect(updated.isActive).toBe(false);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "COMMUNICATION_TEMPLATE", entityId: template.id, action: "communication_template.updated" },
      });
      expect(entries).toHaveLength(1);

      await prisma.communicationTemplate.delete({ where: { id: template.id } });
    });

    it("blocks a role with no grant and no super-admin flag", async () => {
      const template = await createCommunicationTemplate(admin, {
        name: `Update Blocked ${Date.now()}`,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: true,
      });

      await expect(updateCommunicationTemplate(noAccessUser, template.id, { subject: "y" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await prisma.communicationTemplate.delete({ where: { id: template.id } });
    });

    it("throws NotFoundError for an unknown template id", async () => {
      await expect(updateCommunicationTemplate(admin, "nope", { subject: "y" })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("getActiveCommunicationTemplateOrThrow", () => {
    it("returns an active template", async () => {
      const template = await createCommunicationTemplate(admin, {
        name: `Active Resolve ${Date.now()}`,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: true,
      });

      await expect(getActiveCommunicationTemplateOrThrow(template.id)).resolves.toMatchObject({ id: template.id });

      await prisma.communicationTemplate.delete({ where: { id: template.id } });
    });

    it("rejects an inactive template", async () => {
      const template = await createCommunicationTemplate(admin, {
        name: `Inactive Resolve ${Date.now()}`,
        channel: "EMAIL",
        subject: "x",
        body: "x",
        isActive: false,
      });

      await expect(getActiveCommunicationTemplateOrThrow(template.id)).rejects.toBeInstanceOf(ValidationError);

      await prisma.communicationTemplate.delete({ where: { id: template.id } });
    });

    it("rejects an unknown template id", async () => {
      await expect(getActiveCommunicationTemplateOrThrow("nope")).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
