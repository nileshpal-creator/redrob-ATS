import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { getCandidateImportFileHeaders, previewCandidateImport } from "@/lib/services/candidate-import";

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

describe("CandidateImportService — column mapping", () => {
  let creatorRoleId: string;
  let noAccessRoleId: string;

  let creator: SessionContext;
  let noAccessUser: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [creatorRole, noAccessRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: "Test Import Creator",
          rolePermissions: { createMany: { data: [{ resource: "CANDIDATE", action: "CREATE", scope: "ALL" }] } },
        },
      }),
      prisma.role.create({ data: { name: "Test Import No Access" } }), // no grants, by design
    ]);
    creatorRoleId = creatorRole.id;
    noAccessRoleId = noAccessRole.id;

    const [creatorRow, noAccessRow] = await Promise.all([
      prisma.user.create({ data: { name: "Import Creator", email: "import-creator@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Import No Access", email: "import-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: creatorRow.id, roleId: creatorRoleId },
        { userId: noAccessRow.id, roleId: noAccessRoleId },
      ],
    });

    creator = contextFor({ ...creatorRow, roles: [{ id: creatorRoleId, name: "Test Import Creator", isSuperAdmin: false }] });
    noAccessUser = contextFor({ ...noAccessRow, roles: [{ id: noAccessRoleId, name: "Test Import No Access", isSuperAdmin: false }] });
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { createdById: creator.userId } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [creatorRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["import-creator@test.local", "import-noaccess@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [creatorRoleId, noAccessRoleId] } } });
  });

  describe("getCandidateImportFileHeaders", () => {
    it("detects headers and suggests exact case-insensitive matches", async () => {
      const csv = "Full Name,phone,Email\nAda Lovelace,+10000000001,ada@example.com\n";
      const { headers, suggestedMapping } = await getCandidateImportFileHeaders(creator, Buffer.from(csv), "candidates.csv");

      expect(headers).toEqual(["Full Name", "phone", "Email"]);
      expect(suggestedMapping.phone).toBe("phone");
      expect(suggestedMapping.email).toBe("Email");
      // "Full Name" doesn't case-insensitively match "name" — left unmapped
      // for the user to assign explicitly, not guessed.
      expect(suggestedMapping.name).toBeNull();
    });

    it("blocks a role with no CANDIDATE:CREATE grant", async () => {
      await expect(
        getCandidateImportFileHeaders(noAccessUser, Buffer.from("name,phone\n"), "candidates.csv"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("previewCandidateImport with an explicit mapping", () => {
    it("maps a differently-named column to the expected field", async () => {
      const csv = "Full Name,Mobile,Consent Date\nAda Lovelace,+10000000002,2024-01-01\n";
      const mapping = { name: "Full Name", phone: "Mobile", consentGivenAt: "Consent Date" };

      const { rows } = await previewCandidateImport(creator, Buffer.from(csv), "candidates.csv", mapping);

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("valid");
      expect(rows[0].data.name).toBe("Ada Lovelace");
      expect(rows[0].data.phone).toBe("+10000000002");
    });

    it("leaves a field unmapped (null) rather than falling back to auto-detection", async () => {
      // The file *does* have a "name" column, but the mapping explicitly
      // sends it nowhere — it must not be auto-picked-up as a fallback.
      const csv = "name,phone,Consent Date\nAda Lovelace,+10000000003,2024-01-01\n";
      const mapping = { name: null, phone: "phone", consentGivenAt: "Consent Date" };

      const { rows } = await previewCandidateImport(creator, Buffer.from(csv), "candidates.csv", mapping);

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("invalid");
      expect(rows[0].data.name).toBeUndefined();
    });

    it("falls back to auto-detection by field name when no mapping is supplied at all", async () => {
      const csv = "name,phone,consentGivenAt\nAda Lovelace,+10000000004,2024-01-01\n";

      const { rows } = await previewCandidateImport(creator, Buffer.from(csv), "candidates.csv");

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("valid");
      expect(rows[0].data.name).toBe("Ada Lovelace");
    });
  });
});
