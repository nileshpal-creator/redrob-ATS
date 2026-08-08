import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  createCustomObjectRecord,
  createCustomObjectRelation,
  deleteCustomObjectRecord,
  deleteCustomObjectRelation,
  getCustomObjectRecord,
  listCustomObjectRecords,
  listCustomObjectRelations,
  updateCustomObjectRecord,
} from "@/lib/services/custom-object-records";

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

describe("CustomObjectRecordsService", () => {
  let fullRoleId: string;
  let hiddenFieldRoleId: string;
  let noAccessRoleId: string;

  let fullUser: SessionContext;
  let hiddenFieldUser: SessionContext;
  let noAccessUser: SessionContext;

  let vendorDefinitionId: string;
  let vendorApiKey: string;
  let candidateId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const vendorDefinition = await prisma.customObjectDefinition.create({
      data: { apiKey: "test_vendor", name: "Test Vendor", isActive: true },
    });
    vendorDefinitionId = vendorDefinition.id;
    vendorApiKey = vendorDefinition.apiKey;

    await prisma.customFieldDefinition.createMany({
      data: [
        { entityType: vendorApiKey, key: "name", label: "Name", fieldType: "TEXT", isRequired: true },
        { entityType: vendorApiKey, key: "secret", label: "Secret", fieldType: "TEXT", isRequired: false },
      ],
    });

    const fullRole = await prisma.role.create({
      data: {
        name: "Test CO Records Full Access",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "CREATE", scope: "ALL" },
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "READ", scope: "ALL" },
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "UPDATE", scope: "ALL" },
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "DELETE", scope: "ALL" },
            ],
          },
        },
      },
    });
    fullRoleId = fullRole.id;

    const hiddenFieldRole = await prisma.role.create({
      data: {
        name: "Test CO Records Hidden Secret",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "CREATE", scope: "ALL" },
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "READ", scope: "ALL" },
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "UPDATE", scope: "ALL" },
              { resource: "CUSTOM_OBJECT_DEFINITION", action: "DELETE", scope: "ALL" },
            ],
          },
        },
        fieldPermissions: {
          createMany: {
            data: [{ resource: vendorApiKey, field: "customFields.secret", access: "HIDDEN" }],
          },
        },
      },
    });
    hiddenFieldRoleId = hiddenFieldRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test CO Records No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [fullUserRow, hiddenFieldUserRow, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "CO Records Full", email: "co-records-full@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "CO Records Hidden", email: "co-records-hidden@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "CO Records NoAccess", email: "co-records-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: fullUserRow.id, roleId: fullRoleId },
        { userId: hiddenFieldUserRow.id, roleId: hiddenFieldRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    fullUser = contextFor({ ...fullUserRow, roles: [{ id: fullRoleId, name: "Test CO Records Full Access", isSuperAdmin: false }] });
    hiddenFieldUser = contextFor({
      ...hiddenFieldUserRow,
      roles: [{ id: hiddenFieldRoleId, name: "Test CO Records Hidden Secret", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test CO Records No Access", isSuperAdmin: false }],
    });

    const candidate = await prisma.candidate.create({
      data: {
        name: "CO Records Test Candidate",
        phone: "+1 555-0700",
        consentGivenAt: new Date(),
        createdById: fullUserRow.id,
      },
    });
    candidateId = candidate.id;
  });

  afterEach(async () => {
    await prisma.customObjectRelation.deleteMany({ where: { record: { definitionId: vendorDefinitionId } } });
    await prisma.customObjectRecord.deleteMany({ where: { definitionId: vendorDefinitionId } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CUSTOM_OBJECT_DEFINITION" } });
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { id: candidateId } });
    await prisma.customFieldDefinition.deleteMany({ where: { entityType: vendorApiKey } });
    await prisma.customObjectDefinition.deleteMany({ where: { id: vendorDefinitionId } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [fullRoleId, hiddenFieldRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["co-records-full@test.local", "co-records-hidden@test.local", "co-records-noaccess@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [fullRoleId, hiddenFieldRoleId, noAccessRoleId] } } });
  });

  describe("createCustomObjectRecord", () => {
    it("creates a record with data validated against the object's active field definitions", async () => {
      const record = await createCustomObjectRecord(fullUser, {
        definitionId: vendorDefinitionId,
        data: { name: "Acme Corp", secret: "top-secret" },
      });
      expect(record.data).toEqual({ name: "Acme Corp", secret: "top-secret" });
    });

    it("rejects data missing a required field", async () => {
      await expect(
        createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: {} }),
      ).rejects.toThrow();
    });

    it("throws NotFoundError for an unknown definitionId", async () => {
      await expect(
        createCustomObjectRecord(fullUser, { definitionId: "nonexistent-def", data: { name: "X" } }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ForbiddenError for a caller without CUSTOM_OBJECT_DEFINITION:CREATE", async () => {
      await expect(
        createCustomObjectRecord(noAccessUser, { definitionId: vendorDefinitionId, data: { name: "X" } }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("blocks setting a HIDDEN custom field even at creation", async () => {
      await expect(
        createCustomObjectRecord(hiddenFieldUser, {
          definitionId: vendorDefinitionId,
          data: { name: "Acme", secret: "leak-attempt" },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("records an audit log entry", async () => {
      const record = await createCustomObjectRecord(fullUser, {
        definitionId: vendorDefinitionId,
        data: { name: "Acme Corp" },
      });
      const entry = await prisma.auditLog.findFirst({
        where: { action: "custom_object_record.created", entityId: record.id },
      });
      expect(entry).not.toBeNull();
    });
  });

  describe("getCustomObjectRecord / listCustomObjectRecords", () => {
    it("masks a HIDDEN custom field on read for a restricted role", async () => {
      const record = await createCustomObjectRecord(fullUser, {
        definitionId: vendorDefinitionId,
        data: { name: "Acme Corp" },
      });

      const viewed = await getCustomObjectRecord(hiddenFieldUser, record.id);
      expect((viewed.data as Record<string, unknown>).secret).toBeUndefined();

      const asOwner = await getCustomObjectRecord(fullUser, record.id);
      expect(asOwner.data).toEqual({ name: "Acme Corp" });
    });

    it("lists records filtered by definitionId", async () => {
      await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "One" } });
      await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "Two" } });

      const { records, total } = await listCustomObjectRecords(fullUser, {
        definitionId: vendorDefinitionId,
        page: 1,
        pageSize: 25,
      });
      expect(total).toBe(2);
      expect(records).toHaveLength(2);
    });

    it("filters records by relatedEntityType/relatedEntityId through their relations", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "Linked" } });
      await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "Unlinked" } });

      await createCustomObjectRelation(fullUser, {
        recordId: record.id,
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
      });

      const { records } = await listCustomObjectRecords(fullUser, {
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
        page: 1,
        pageSize: 25,
      });
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(record.id);
    });

    it("throws NotFoundError for an unknown record id", async () => {
      await expect(getCustomObjectRecord(fullUser, "nonexistent-record")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateCustomObjectRecord", () => {
    it("fully replaces data rather than merging", async () => {
      const record = await createCustomObjectRecord(fullUser, {
        definitionId: vendorDefinitionId,
        data: { name: "Acme Corp", secret: "s1" },
      });

      const updated = await updateCustomObjectRecord(fullUser, record.id, { data: { name: "Acme Corp Renamed" } });
      expect(updated.data).toEqual({ name: "Acme Corp Renamed" });
    });

    it("blocks writing a HIDDEN custom field on update", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "Acme" } });

      await expect(
        updateCustomObjectRecord(hiddenFieldUser, record.id, { data: { name: "Acme", secret: "leak" } }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("records an audit log entry with before/after", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });
      await updateCustomObjectRecord(fullUser, record.id, { data: { name: "B" } });

      const entry = await prisma.auditLog.findFirst({
        where: { action: "custom_object_record.updated", entityId: record.id },
      });
      expect(entry).not.toBeNull();
    });
  });

  describe("deleteCustomObjectRecord", () => {
    it("deletes the record and cascade-deletes its relations", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });
      await createCustomObjectRelation(fullUser, {
        recordId: record.id,
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
      });

      await deleteCustomObjectRecord(fullUser, record.id);

      await expect(getCustomObjectRecord(fullUser, record.id)).rejects.toBeInstanceOf(NotFoundError);
      expect(await prisma.customObjectRelation.findMany({ where: { recordId: record.id } })).toEqual([]);
    });
  });

  describe("createCustomObjectRelation / listCustomObjectRelations / deleteCustomObjectRelation", () => {
    it("links a record to an existing core entity", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });

      const relation = await createCustomObjectRelation(fullUser, {
        recordId: record.id,
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
      });
      expect(relation.relatedEntityId).toBe(candidateId);

      const relations = await listCustomObjectRelations(fullUser, record.id);
      expect(relations).toHaveLength(1);
    });

    it("rejects a relatedEntityType outside the core, custom-field-capable entities", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });

      await expect(
        createCustomObjectRelation(fullUser, {
          recordId: record.id,
          relatedEntityType: "CUSTOM_OBJECT_DEFINITION",
          relatedEntityId: vendorDefinitionId,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws NotFoundError when the related entity id doesn't exist", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });

      await expect(
        createCustomObjectRelation(fullUser, {
          recordId: record.id,
          relatedEntityType: "CANDIDATE",
          relatedEntityId: "nonexistent-candidate",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns the existing relation instead of creating a duplicate for the same triple", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });

      const first = await createCustomObjectRelation(fullUser, {
        recordId: record.id,
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
      });
      const second = await createCustomObjectRelation(fullUser, {
        recordId: record.id,
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
      });

      expect(second.id).toBe(first.id);
      expect(await prisma.customObjectRelation.count({ where: { recordId: record.id } })).toBe(1);
    });

    it("deletes a relation", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });
      const relation = await createCustomObjectRelation(fullUser, {
        recordId: record.id,
        relatedEntityType: "CANDIDATE",
        relatedEntityId: candidateId,
      });

      await deleteCustomObjectRelation(fullUser, relation.id);
      expect(await listCustomObjectRelations(fullUser, record.id)).toEqual([]);
    });

    it("throws ForbiddenError for a caller without CUSTOM_OBJECT_DEFINITION:UPDATE", async () => {
      const record = await createCustomObjectRecord(fullUser, { definitionId: vendorDefinitionId, data: { name: "A" } });

      await expect(
        createCustomObjectRelation(noAccessUser, {
          recordId: record.id,
          relatedEntityType: "CANDIDATE",
          relatedEntityId: candidateId,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
