import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createSavedReport,
  deleteSavedReport,
  getSavedReport,
  listSavedReports,
  updateSavedReport,
} from "@/lib/services/saved-reports";

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

describe("SavedReportService", () => {
  let ownerRoleId: string;
  let restrictedRoleId: string;
  let noAccessRoleId: string;

  let owner: SessionContext;
  let restricted: SessionContext;
  let noAccessUser: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [ownerRole, restrictedRole, noAccessRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: "Test SavedReport Owner",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "SAVED_REPORT", action: "CREATE", scope: "ALL" },
                { resource: "SAVED_REPORT", action: "READ", scope: "ALL" },
                { resource: "SAVED_REPORT", action: "UPDATE", scope: "OWN" },
                { resource: "SAVED_REPORT", action: "DELETE", scope: "OWN" },
              ],
            },
          },
        },
      }),
      prisma.role.create({
        data: {
          name: "Test SavedReport Restricted",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "SAVED_REPORT", action: "READ", scope: "OWN" },
                { resource: "SAVED_REPORT", action: "UPDATE", scope: "OWN" },
                { resource: "SAVED_REPORT", action: "DELETE", scope: "OWN" },
              ],
            },
          },
        },
      }),
      prisma.role.create({ data: { name: "Test SavedReport No Access" } }), // no grants, by design
    ]);
    ownerRoleId = ownerRole.id;
    restrictedRoleId = restrictedRole.id;
    noAccessRoleId = noAccessRole.id;

    const [ownerRow, restrictedRow, noAccessRow] = await Promise.all([
      prisma.user.create({ data: { name: "SR Owner", email: "sr-owner@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "SR Restricted", email: "sr-restricted@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "SR No Access", email: "sr-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: ownerRow.id, roleId: ownerRoleId },
        { userId: restrictedRow.id, roleId: restrictedRoleId },
        { userId: noAccessRow.id, roleId: noAccessRoleId },
      ],
    });

    owner = contextFor({ ...ownerRow, roles: [{ id: ownerRoleId, name: "Test SavedReport Owner", isSuperAdmin: false }] });
    restricted = contextFor({
      ...restrictedRow,
      roles: [{ id: restrictedRoleId, name: "Test SavedReport Restricted", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessRow,
      roles: [{ id: noAccessRoleId, name: "Test SavedReport No Access", isSuperAdmin: false }],
    });
  });

  afterAll(async () => {
    await prisma.savedReport.deleteMany({ where: { createdById: { in: [owner.userId, restricted.userId] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, restrictedRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["sr-owner@test.local", "sr-restricted@test.local", "sr-noaccess@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, restrictedRoleId, noAccessRoleId] } } });
  });

  describe("createSavedReport", () => {
    it("creates a report and validates filters against its reportType's schema", async () => {
      const report = await createSavedReport(owner, {
        name: "Weekly Funnel",
        reportType: "PIPELINE_FUNNEL",
        filters: { jobId: "job1" },
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });
      expect(report.name).toBe("Weekly Funnel");
      expect(report.filters).toEqual({ jobId: "job1" });

      const entries = await prisma.auditLog.findMany({ where: { entityType: "SAVED_REPORT", entityId: report.id } });
      expect(entries.map((entry) => entry.action)).toEqual(["saved_report.created"]);

      await prisma.savedReport.delete({ where: { id: report.id } });
    });

    it("rejects filters that don't match the reportType's own query schema", async () => {
      // PIPELINE_FUNNEL requires jobId — an empty filters object fails that schema.
      await expect(
        createSavedReport(owner, {
          name: "Bad Filters",
          reportType: "PIPELINE_FUNNEL",
          filters: {},
          scheduleFrequency: "NONE",
          recipientEmails: [],
          exportFormat: "XLSX",
        }),
      ).rejects.toThrow();
    });

    it("blocks a role with no SAVED_REPORT grant", async () => {
      await expect(
        createSavedReport(noAccessUser, {
          name: "Should Fail",
          reportType: "RECRUITER_PRODUCTIVITY",
          filters: {},
          scheduleFrequency: "NONE",
          recipientEmails: [],
          exportFormat: "XLSX",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("listSavedReports / getSavedReport", () => {
    it("an ALL-scope viewer sees an OWN-scope creator's report; the OWN-scope creator sees only their own", async () => {
      const ownerReport = await createSavedReport(owner, {
        name: "Owner Report",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      const asOwner = await listSavedReports(owner, {});
      expect(asOwner.map((row) => row.id)).toContain(ownerReport.id);

      const asRestricted = await listSavedReports(restricted, {});
      expect(asRestricted.map((row) => row.id)).not.toContain(ownerReport.id);

      await expect(getSavedReport(restricted, ownerReport.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.savedReport.delete({ where: { id: ownerReport.id } });
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(getSavedReport(owner, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateSavedReport", () => {
    it("updates fields, re-validates filters, and bumps version", async () => {
      const report = await createSavedReport(owner, {
        name: "Update Target",
        reportType: "PIPELINE_FUNNEL",
        filters: { jobId: "job1" },
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      const updated = await updateSavedReport(owner, report.id, {
        version: report.version,
        filters: { jobId: "job2", recruiterId: "user1" },
      });
      expect(updated.filters).toEqual({ jobId: "job2", recruiterId: "user1" });
      expect(updated.version).toBe(report.version + 1);

      await prisma.savedReport.delete({ where: { id: report.id } });
    });

    it("rejects scheduling delivery with no recipient emails", async () => {
      const report = await createSavedReport(owner, {
        name: "Schedule Target",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      await expect(
        updateSavedReport(owner, report.id, { version: report.version, scheduleFrequency: "DAILY" }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.savedReport.delete({ where: { id: report.id } });
    });

    it("allows scheduling with recipient emails set at creation time, not re-sent on the update", async () => {
      const report = await createSavedReport(owner, {
        name: "Schedule From Existing Recipients",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: ["already-set@test.local"],
        exportFormat: "XLSX",
      });

      const updated = await updateSavedReport(owner, report.id, { version: report.version, scheduleFrequency: "DAILY" });
      expect(updated.scheduleFrequency).toBe("DAILY");
      expect(updated.recipientEmails).toEqual(["already-set@test.local"]);

      await prisma.savedReport.delete({ where: { id: report.id } });
    });

    it("throws ConflictError on a stale version — the second of two concurrent updates loses", async () => {
      const report = await createSavedReport(owner, {
        name: "Concurrency Target",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      const results = await Promise.allSettled([
        updateSavedReport(owner, report.id, { version: report.version, name: "First Update" }),
        updateSavedReport(owner, report.id, { version: report.version, name: "Second Update" }),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

      await prisma.savedReport.delete({ where: { id: report.id } });
    });

    it("blocks a viewer without an UPDATE grant on this report's owner", async () => {
      const report = await createSavedReport(owner, {
        name: "Blocked Update",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      await expect(updateSavedReport(restricted, report.id, { version: report.version, name: "x" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await prisma.savedReport.delete({ where: { id: report.id } });
    });
  });

  describe("deleteSavedReport", () => {
    it("hard-deletes and records an audit entry", async () => {
      const report = await createSavedReport(owner, {
        name: "Delete Target",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      await deleteSavedReport(owner, report.id);

      await expect(prisma.savedReport.findUniqueOrThrow({ where: { id: report.id } })).rejects.toThrow();
      const entries = await prisma.auditLog.findMany({ where: { entityType: "SAVED_REPORT", entityId: report.id, action: "saved_report.deleted" } });
      expect(entries).toHaveLength(1);
    });

    it("blocks a viewer without a DELETE grant on this report's owner", async () => {
      const report = await createSavedReport(owner, {
        name: "Blocked Delete",
        reportType: "RECRUITER_PRODUCTIVITY",
        filters: {},
        scheduleFrequency: "NONE",
        recipientEmails: [],
        exportFormat: "XLSX",
      });

      await expect(deleteSavedReport(restricted, report.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.savedReport.delete({ where: { id: report.id } });
    });
  });
});
