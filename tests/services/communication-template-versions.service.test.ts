import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ValidationError } from "@/lib/errors";
import {
  createCommunicationTemplateVersion,
  decideCommunicationTemplateVersion,
  listCommunicationTemplateVersions,
  resolvePersonalizedTemplateContent,
  rollbackCommunicationTemplateVersion,
  submitCommunicationTemplateVersion,
} from "@/lib/services/communication-template-versions";

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

describe("CommunicationTemplateVersionService", () => {
  let noAccessRoleId: string;
  let editorRoleId: string; // UPDATE only, no APPROVE — can draft/submit, can't decide/rollback
  let adminRoleId: string;

  let noAccessUser: SessionContext;
  let editor: SessionContext;
  let admin: SessionContext;

  let templateId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [noAccessRole, editorRole, adminRole] = await Promise.all([
      prisma.role.create({ data: { name: "Test TplVersion No Access" } }), // no grants, by design
      prisma.role.create({
        data: {
          name: "Test TplVersion Editor",
          rolePermissions: { createMany: { data: [{ resource: "COMMUNICATION_TEMPLATE", action: "UPDATE", scope: "ALL" }] } },
        },
      }),
      prisma.role.create({ data: { name: "Test TplVersion Admin", isSuperAdmin: true } }),
    ]);
    noAccessRoleId = noAccessRole.id;
    editorRoleId = editorRole.id;
    adminRoleId = adminRole.id;

    const [noAccessRow, editorRow, adminRow] = await Promise.all([
      prisma.user.create({ data: { name: "TplVersion No Access", email: "tplversion-noaccess@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "TplVersion Editor", email: "tplversion-editor@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "TplVersion Admin", email: "tplversion-admin@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: noAccessRow.id, roleId: noAccessRoleId },
        { userId: editorRow.id, roleId: editorRoleId },
        { userId: adminRow.id, roleId: adminRoleId },
      ],
    });

    noAccessUser = contextFor({ ...noAccessRow, roles: [{ id: noAccessRoleId, name: "Test TplVersion No Access", isSuperAdmin: false }] });
    editor = contextFor({ ...editorRow, roles: [{ id: editorRoleId, name: "Test TplVersion Editor", isSuperAdmin: false }] });
    admin = contextFor({ ...adminRow, roles: [{ id: adminRoleId, name: "Test TplVersion Admin", isSuperAdmin: true }] });

    const template = await prisma.communicationTemplate.create({
      data: {
        name: `TplVersion Target ${Date.now()}`,
        channel: "EMAIL",
        subject: "Legacy subject",
        body: "Legacy body",
        isActive: true,
        createdById: admin.userId,
      },
    });
    templateId = template.id;
  });

  afterAll(async () => {
    await prisma.communicationTemplate.deleteMany({ where: { id: templateId } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [noAccessRoleId, editorRoleId, adminRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["tplversion-noaccess@test.local", "tplversion-editor@test.local", "tplversion-admin@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [noAccessRoleId, editorRoleId, adminRoleId] } } });
  });

  describe("createCommunicationTemplateVersion", () => {
    it("starts each language's own version numbering at 1 and increments independently", async () => {
      const enV1 = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "en v1", body: "en v1 body" });
      expect(enV1.versionNumber).toBe(1);
      expect(enV1.status).toBe("DRAFT");

      const enV2 = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "en v2", body: "en v2 body" });
      expect(enV2.versionNumber).toBe(2);

      const esV1 = await createCommunicationTemplateVersion(editor, templateId, { language: "es", subject: "es v1", body: "es v1 body" });
      expect(esV1.versionNumber).toBe(1);

      await prisma.communicationTemplateVersion.deleteMany({ where: { id: { in: [enV1.id, enV2.id, esV1.id] } } });
    });

    it("blocks a role with neither an UPDATE grant nor super-admin", async () => {
      await expect(
        createCommunicationTemplateVersion(noAccessUser, templateId, { language: "en", subject: "x", body: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("submitCommunicationTemplateVersion", () => {
    it("moves a draft to pending approval", async () => {
      const draft = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s", body: "b" });
      const submitted = await submitCommunicationTemplateVersion(editor, templateId, draft.id);
      expect(submitted.status).toBe("PENDING_APPROVAL");
      expect(submitted.submittedBy?.name).toBe("TplVersion Editor");

      await prisma.communicationTemplateVersion.delete({ where: { id: draft.id } });
    });

    it("rejects submitting a version that isn't a draft", async () => {
      const draft = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s", body: "b" });
      await submitCommunicationTemplateVersion(editor, templateId, draft.id);

      await expect(submitCommunicationTemplateVersion(editor, templateId, draft.id)).rejects.toBeInstanceOf(ValidationError);

      await prisma.communicationTemplateVersion.delete({ where: { id: draft.id } });
    });
  });

  describe("decideCommunicationTemplateVersion", () => {
    it("approving an 'en' version activates it, archives the prior active 'en' version, and syncs CommunicationTemplate.subject/body", async () => {
      const first = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "first", body: "first body" });
      await submitCommunicationTemplateVersion(editor, templateId, first.id);
      const firstActive = await decideCommunicationTemplateVersion(admin, templateId, first.id, { decision: "APPROVE" });
      expect(firstActive.status).toBe("ACTIVE");

      let template = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      expect(template.subject).toBe("first");
      expect(template.body).toBe("first body");

      const second = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "second", body: "second body" });
      await submitCommunicationTemplateVersion(editor, templateId, second.id);
      await decideCommunicationTemplateVersion(admin, templateId, second.id, { decision: "APPROVE" });

      template = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      expect(template.subject).toBe("second");

      const firstReloaded = await prisma.communicationTemplateVersion.findUniqueOrThrow({ where: { id: first.id } });
      expect(firstReloaded.status).toBe("ARCHIVED");

      await prisma.communicationTemplateVersion.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    });

    it("approving a non-'en' version never touches CommunicationTemplate.subject/body", async () => {
      const before = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });

      const esDraft = await createCommunicationTemplateVersion(editor, templateId, { language: "es", subject: "hola", body: "hola body" });
      await submitCommunicationTemplateVersion(editor, templateId, esDraft.id);
      await decideCommunicationTemplateVersion(admin, templateId, esDraft.id, { decision: "APPROVE" });

      const after = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      expect(after.subject).toBe(before.subject);
      expect(after.body).toBe(before.body);

      await prisma.communicationTemplateVersion.delete({ where: { id: esDraft.id } });
    });

    it("rejects a version, leaving CommunicationTemplate untouched", async () => {
      const before = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });

      const draft = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "rejected", body: "rejected body" });
      await submitCommunicationTemplateVersion(editor, templateId, draft.id);
      const decided = await decideCommunicationTemplateVersion(admin, templateId, draft.id, { decision: "REJECT", comments: "not ready" });
      expect(decided.status).toBe("REJECTED");
      expect(decided.comments).toBe("not ready");

      const after = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      expect(after.subject).toBe(before.subject);

      await prisma.communicationTemplateVersion.delete({ where: { id: draft.id } });
    });

    it("rejects deciding a version that isn't pending approval", async () => {
      const draft = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s", body: "b" });

      await expect(decideCommunicationTemplateVersion(admin, templateId, draft.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(
        ValidationError,
      );

      await prisma.communicationTemplateVersion.delete({ where: { id: draft.id } });
    });

    it("blocks a role with UPDATE but no APPROVE grant", async () => {
      const draft = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s", body: "b" });
      await submitCommunicationTemplateVersion(editor, templateId, draft.id);

      await expect(decideCommunicationTemplateVersion(editor, templateId, draft.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await prisma.communicationTemplateVersion.delete({ where: { id: draft.id } });
    });
  });

  describe("rollbackCommunicationTemplateVersion", () => {
    it("restores an archived version to active and re-syncs CommunicationTemplate for 'en'", async () => {
      const first = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "rollback-v1", body: "v1 body" });
      await submitCommunicationTemplateVersion(editor, templateId, first.id);
      await decideCommunicationTemplateVersion(admin, templateId, first.id, { decision: "APPROVE" });

      const second = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "rollback-v2", body: "v2 body" });
      await submitCommunicationTemplateVersion(editor, templateId, second.id);
      await decideCommunicationTemplateVersion(admin, templateId, second.id, { decision: "APPROVE" });

      const restored = await rollbackCommunicationTemplateVersion(admin, templateId, first.id);
      expect(restored.status).toBe("ACTIVE");

      const secondReloaded = await prisma.communicationTemplateVersion.findUniqueOrThrow({ where: { id: second.id } });
      expect(secondReloaded.status).toBe("ARCHIVED");

      const template = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      expect(template.subject).toBe("rollback-v1");

      await prisma.communicationTemplateVersion.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    });

    it("rejects restoring a version that was never active", async () => {
      const draft = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s", body: "b" });

      await expect(rollbackCommunicationTemplateVersion(admin, templateId, draft.id)).rejects.toBeInstanceOf(ValidationError);

      await prisma.communicationTemplateVersion.delete({ where: { id: draft.id } });
    });

    it("blocks a role with UPDATE but no APPROVE grant", async () => {
      const first = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s1", body: "b1" });
      await submitCommunicationTemplateVersion(editor, templateId, first.id);
      await decideCommunicationTemplateVersion(admin, templateId, first.id, { decision: "APPROVE" });

      const second = await createCommunicationTemplateVersion(editor, templateId, { language: "en", subject: "s2", body: "b2" });
      await submitCommunicationTemplateVersion(editor, templateId, second.id);
      await decideCommunicationTemplateVersion(admin, templateId, second.id, { decision: "APPROVE" });

      await expect(rollbackCommunicationTemplateVersion(editor, templateId, first.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.communicationTemplateVersion.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    });
  });

  describe("listCommunicationTemplateVersions", () => {
    it("blocks a role with no grant", async () => {
      await expect(listCommunicationTemplateVersions(noAccessUser, templateId)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("resolvePersonalizedTemplateContent", () => {
    const template = { id: "irrelevant", subject: "default subject", body: "default body" };

    it("falls back to the template's own content when language is null/undefined/'en'", async () => {
      expect(await resolvePersonalizedTemplateContent(template, null)).toEqual({ subject: "default subject", body: "default body" });
      expect(await resolvePersonalizedTemplateContent(template, undefined)).toEqual({ subject: "default subject", body: "default body" });
      expect(await resolvePersonalizedTemplateContent(template, "en")).toEqual({ subject: "default subject", body: "default body" });
    });

    it("resolves an ACTIVE variant for a matching language", async () => {
      const frDraft = await createCommunicationTemplateVersion(editor, templateId, { language: "fr", subject: "bonjour", body: "bonjour body" });
      await submitCommunicationTemplateVersion(editor, templateId, frDraft.id);
      await decideCommunicationTemplateVersion(admin, templateId, frDraft.id, { decision: "APPROVE" });

      const realTemplate = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      const resolved = await resolvePersonalizedTemplateContent(realTemplate, "fr");
      expect(resolved).toEqual({ subject: "bonjour", body: "bonjour body" });

      await prisma.communicationTemplateVersion.delete({ where: { id: frDraft.id } });
    });

    it("falls back to the template's own content when no ACTIVE variant exists for that language", async () => {
      const realTemplate = await prisma.communicationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      const resolved = await resolvePersonalizedTemplateContent(realTemplate, "de");
      expect(resolved).toEqual({ subject: realTemplate.subject, body: realTemplate.body });
    });
  });
});
