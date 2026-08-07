import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { exportReport, renderReportBuffer } from "@/lib/services/report-export";

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

describe("report export", () => {
  let roleId: string;
  let noAccessRoleId: string;
  let viewer: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let jobId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [role, noAccessRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: "Test Report Export Viewer",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "JOB", action: "READ", scope: "ALL" },
                { resource: "OFFER", action: "READ", scope: "ALL" },
              ],
            },
          },
        },
      }),
      prisma.role.create({ data: { name: "Test Report Export No Access" } }), // no grants, by design
    ]);
    roleId = role.id;
    noAccessRoleId = noAccessRole.id;

    const [viewerRow, noAccessRow] = await Promise.all([
      prisma.user.create({ data: { name: "Export Viewer", email: "report-export-viewer@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Export No Access", email: "report-export-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: viewerRow.id, roleId },
        { userId: noAccessRow.id, roleId: noAccessRoleId },
      ],
    });

    viewer = contextFor({ ...viewerRow, roles: [{ id: roleId, name: "Test Report Export Viewer", isSuperAdmin: false }] });
    noAccessUser = contextFor({
      ...noAccessRow,
      roles: [{ id: noAccessRoleId, name: "Test Report Export No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const job = await prisma.job.create({
      data: {
        title: "Export Test Job",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "MEDIUM",
        status: "OPEN",
        positionsCount: 1,
        primaryRecruiterId: viewer.userId,
        createdById: viewer.userId,
      },
    });
    jobId = job.id;
    await prisma.pipelineStage.create({ data: { jobId, name: "Applied", sortOrder: 0 } });
  });

  afterAll(async () => {
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [roleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["report-export-viewer@test.local", "report-export-noaccess@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [roleId, noAccessRoleId] } } });
  });

  it("renders a real, parseable XLSX workbook with the report's column headers", async () => {
    const { buffer, mimeType, fileName } = await renderReportBuffer(viewer, {
      reportType: "PIPELINE_FUNNEL",
      format: "XLSX",
      filters: { jobId },
    });
    expect(mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(fileName).toBe("pipeline_funnel-report.xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const headerRow = workbook.worksheets[0].getRow(1).values;
    expect(headerRow).toContain("Stage");
    const firstDataRow = workbook.worksheets[0].getRow(2).values;
    expect(firstDataRow).toContain("Applied");
  });

  it("renders CSV with the report's rows as real, parseable text", async () => {
    const { buffer, mimeType } = await renderReportBuffer(viewer, {
      reportType: "RECRUITER_PRODUCTIVITY",
      format: "CSV",
      filters: { recruiterId: viewer.userId },
    });
    expect(mimeType).toBe("text/csv");
    const text = buffer.toString("utf-8");
    expect(text.split("\n")[0]).toContain("Recruiter");
    expect(text).toContain("Export Viewer");
  });

  it("renders a real PDF (correct magic bytes) even with an empty row set", async () => {
    const { buffer, mimeType } = await renderReportBuffer(viewer, {
      reportType: "OFFER_TAT_COMPLIANCE",
      format: "PDF",
      filters: { tatThresholdDays: 3 },
    });
    expect(mimeType).toBe("application/pdf");
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("exportReport (unlike renderReportBuffer) writes an audit log entry", async () => {
    const before = await prisma.auditLog.count({ where: { action: "report.exported", actorId: viewer.userId } });

    await renderReportBuffer(viewer, { reportType: "RECRUITER_PRODUCTIVITY", format: "CSV", filters: {} });
    expect(await prisma.auditLog.count({ where: { action: "report.exported", actorId: viewer.userId } })).toBe(before);

    await exportReport(viewer, { reportType: "RECRUITER_PRODUCTIVITY", format: "CSV", filters: {} });
    expect(await prisma.auditLog.count({ where: { action: "report.exported", actorId: viewer.userId } })).toBe(before + 1);
  });

  it("propagates ForbiddenError for a report type the caller has no grant for", async () => {
    await expect(
      exportReport(noAccessUser, { reportType: "OFFER_TAT_COMPLIANCE", format: "CSV", filters: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects filters that don't satisfy the reportType's own query schema", async () => {
    await expect(
      exportReport(viewer, { reportType: "PIPELINE_FUNNEL", format: "CSV", filters: {} }), // missing required jobId
    ).rejects.toThrow();
  });
});
