import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createDashboard,
  createDashboardWidget,
  deleteDashboard,
  deleteDashboardWidget,
  getDashboard,
  getDashboardData,
  listDashboards,
  updateDashboard,
  updateDashboardWidget,
} from "@/lib/services/dashboards";

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

describe("DashboardService", () => {
  let ownerRoleId: string;
  let restrictedRoleId: string;
  let noAccessRoleId: string;
  // Same DASHBOARD:READ ALL grant as `owner`, but only JOB:READ OWN (no
  // owned jobs) — used to prove a widget's COUNT recomputes against the
  // *viewer's* own RBAC scope, not the dashboard creator's (§10.5).
  let jobRestrictedViewerRoleId: string;

  let owner: SessionContext;
  let restricted: SessionContext;
  let noAccessUser: SessionContext;
  let jobRestrictedViewer: SessionContext;

  let jobId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [ownerRole, restrictedRole, noAccessRole, jobRestrictedViewerRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: "Test Dashboard Owner",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "DASHBOARD", action: "CREATE", scope: "ALL" },
                { resource: "DASHBOARD", action: "READ", scope: "ALL" },
                { resource: "DASHBOARD", action: "UPDATE", scope: "OWN" },
                { resource: "DASHBOARD", action: "DELETE", scope: "OWN" },
                { resource: "JOB", action: "READ", scope: "ALL" },
                { resource: "JOB", action: "CREATE", scope: "ALL" },
              ],
            },
          },
        },
      }),
      prisma.role.create({
        data: {
          name: "Test Dashboard Restricted",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "DASHBOARD", action: "READ", scope: "OWN" },
                { resource: "DASHBOARD", action: "UPDATE", scope: "OWN" },
                { resource: "DASHBOARD", action: "DELETE", scope: "OWN" },
              ],
            },
          },
        },
      }),
      prisma.role.create({ data: { name: "Test Dashboard No Access" } }), // no grants, by design
      prisma.role.create({
        data: {
          name: "Test Dashboard Job Restricted Viewer",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "DASHBOARD", action: "READ", scope: "ALL" },
                { resource: "JOB", action: "READ", scope: "OWN" },
              ],
            },
          },
        },
      }),
    ]);
    ownerRoleId = ownerRole.id;
    restrictedRoleId = restrictedRole.id;
    noAccessRoleId = noAccessRole.id;
    jobRestrictedViewerRoleId = jobRestrictedViewerRole.id;

    const [ownerRow, restrictedRow, noAccessRow, jobRestrictedViewerRow] = await Promise.all([
      prisma.user.create({ data: { name: "DB Owner", email: "db-owner@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "DB Restricted", email: "db-restricted@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "DB No Access", email: "db-noaccess@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "DB Job Restricted Viewer", email: "db-jobrestricted@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: ownerRow.id, roleId: ownerRoleId },
        { userId: restrictedRow.id, roleId: restrictedRoleId },
        { userId: noAccessRow.id, roleId: noAccessRoleId },
        { userId: jobRestrictedViewerRow.id, roleId: jobRestrictedViewerRoleId },
      ],
    });

    owner = contextFor({ ...ownerRow, roles: [{ id: ownerRoleId, name: "Test Dashboard Owner", isSuperAdmin: false }] });
    restricted = contextFor({
      ...restrictedRow,
      roles: [{ id: restrictedRoleId, name: "Test Dashboard Restricted", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessRow,
      roles: [{ id: noAccessRoleId, name: "Test Dashboard No Access", isSuperAdmin: false }],
    });
    jobRestrictedViewer = contextFor({
      ...jobRestrictedViewerRow,
      roles: [{ id: jobRestrictedViewerRoleId, name: "Test Dashboard Job Restricted Viewer", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DASHBOARD_TEST_DEPT", label: "Dept", values: { create: { value: "eng", label: "Engineering" } } },
    });
    const departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;
    const location = await prisma.controlledList.create({
      data: { key: "DASHBOARD_TEST_LOC", label: "Loc", values: { create: { value: "remote", label: "Remote" } } },
    });
    const locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const job = await prisma.job.create({
      data: {
        title: "Dashboard Test Job",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "MEDIUM",
        status: "OPEN",
        positionsCount: 3,
        primaryRecruiterId: owner.userId,
        createdById: owner.userId,
      },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DASHBOARD_TEST_DEPT", "DASHBOARD_TEST_LOC"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DASHBOARD_TEST_DEPT", "DASHBOARD_TEST_LOC"] } } });
    await prisma.dashboard.deleteMany({ where: { createdById: { in: [owner.userId, restricted.userId] } } });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: [ownerRoleId, restrictedRoleId, noAccessRoleId, jobRestrictedViewerRoleId] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: ["db-owner@test.local", "db-restricted@test.local", "db-noaccess@test.local", "db-jobrestricted@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, restrictedRoleId, noAccessRoleId, jobRestrictedViewerRoleId] } } });
  });

  describe("createDashboard", () => {
    it("creates a dashboard and records an audit entry", async () => {
      const dashboard = await createDashboard(owner, { name: "My Dashboard", description: "desc" });
      expect(dashboard.name).toBe("My Dashboard");
      expect(dashboard.createdById).toBe(owner.userId);

      const entries = await prisma.auditLog.findMany({ where: { entityType: "DASHBOARD", entityId: dashboard.id } });
      expect(entries.map((entry) => entry.action)).toEqual(["dashboard.created"]);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("blocks a role with no DASHBOARD grant", async () => {
      await expect(createDashboard(noAccessUser, { name: "Should Fail" })).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("listDashboards / getDashboard", () => {
    it("an ALL-scope viewer sees an OWN-scope creator's dashboard; the OWN-scope creator sees only their own", async () => {
      const ownerDashboard = await createDashboard(owner, { name: "Owner Dashboard" });

      const asOwner = await listDashboards(owner);
      expect(asOwner.map((row) => row.id)).toContain(ownerDashboard.id);

      const asRestricted = await listDashboards(restricted);
      expect(asRestricted.map((row) => row.id)).not.toContain(ownerDashboard.id);

      await expect(getDashboard(restricted, ownerDashboard.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.dashboard.delete({ where: { id: ownerDashboard.id } });
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(getDashboard(owner, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateDashboard", () => {
    it("updates fields and bumps version", async () => {
      const dashboard = await createDashboard(owner, { name: "Update Target" });

      const updated = await updateDashboard(owner, dashboard.id, { version: dashboard.version, name: "Updated Name" });
      expect(updated.name).toBe("Updated Name");
      expect(updated.version).toBe(dashboard.version + 1);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("throws ConflictError on a stale version", async () => {
      const dashboard = await createDashboard(owner, { name: "Concurrency Target" });

      const results = await Promise.allSettled([
        updateDashboard(owner, dashboard.id, { version: dashboard.version, name: "First" }),
        updateDashboard(owner, dashboard.id, { version: dashboard.version, name: "Second" }),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("blocks a viewer without an UPDATE grant on this dashboard's owner", async () => {
      const dashboard = await createDashboard(owner, { name: "Blocked Update" });

      await expect(updateDashboard(restricted, dashboard.id, { version: dashboard.version, name: "x" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });
  });

  describe("deleteDashboard", () => {
    it("deletes the dashboard, cascades its widgets, and records an audit entry", async () => {
      const dashboard = await createDashboard(owner, { name: "Delete Target" });
      const widget = await createDashboardWidget(owner, dashboard.id, {
        title: "W",
        entityType: "JOB",
        aggregate: "COUNT",
        filters: [],
        sortOrder: 0,
      });

      await deleteDashboard(owner, dashboard.id);

      await expect(prisma.dashboard.findUniqueOrThrow({ where: { id: dashboard.id } })).rejects.toThrow();
      expect(await prisma.dashboardWidget.findUnique({ where: { id: widget.id } })).toBeNull();
      const entries = await prisma.auditLog.findMany({
        where: { entityType: "DASHBOARD", entityId: dashboard.id, action: "dashboard.deleted" },
      });
      expect(entries).toHaveLength(1);
    });

    it("blocks a viewer without a DELETE grant on this dashboard's owner", async () => {
      const dashboard = await createDashboard(owner, { name: "Blocked Delete" });

      await expect(deleteDashboard(restricted, dashboard.id)).rejects.toBeInstanceOf(ForbiddenError);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });
  });

  describe("createDashboardWidget / updateDashboardWidget / deleteDashboardWidget", () => {
    it("rejects an unknown entityType", async () => {
      const dashboard = await createDashboard(owner, { name: "Widget Entity Target" });

      await expect(
        createDashboardWidget(owner, dashboard.id, {
          title: "Bad",
          entityType: "NOT_A_REAL_ENTITY",
          aggregate: "COUNT",
          filters: [],
          sortOrder: 0,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("creates, updates, and deletes a widget, each recording an audit entry", async () => {
      const dashboard = await createDashboard(owner, { name: "Widget CRUD Target" });

      const widget = await createDashboardWidget(owner, dashboard.id, {
        title: "Jobs by status",
        entityType: "JOB",
        aggregate: "COUNT",
        groupByKey: "status",
        filters: [],
        sortOrder: 0,
      });
      expect(widget.groupByKey).toBe("status");

      const updated = await updateDashboardWidget(owner, dashboard.id, widget.id, { title: "Renamed" });
      expect(updated.title).toBe("Renamed");

      await deleteDashboardWidget(owner, dashboard.id, widget.id);
      expect(await prisma.dashboardWidget.findUnique({ where: { id: widget.id } })).toBeNull();

      const actions = (
        await prisma.auditLog.findMany({ where: { entityType: "DASHBOARD", entityId: dashboard.id }, orderBy: { createdAt: "asc" } })
      ).map((entry) => entry.action);
      expect(actions).toEqual([
        "dashboard.created",
        "dashboard_widget.created",
        "dashboard_widget.updated",
        "dashboard_widget.deleted",
      ]);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("throws NotFoundError when the widget doesn't belong to the given dashboard", async () => {
      const [dashboardA, dashboardB] = await Promise.all([
        createDashboard(owner, { name: "Widget Dashboard A" }),
        createDashboard(owner, { name: "Widget Dashboard B" }),
      ]);
      const widget = await createDashboardWidget(owner, dashboardA.id, {
        title: "W",
        entityType: "JOB",
        aggregate: "COUNT",
        filters: [],
        sortOrder: 0,
      });

      await expect(updateDashboardWidget(owner, dashboardB.id, widget.id, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteDashboardWidget(owner, dashboardB.id, widget.id)).rejects.toBeInstanceOf(NotFoundError);

      await prisma.dashboard.deleteMany({ where: { id: { in: [dashboardA.id, dashboardB.id] } } });
    });
  });

  describe("getDashboardData — row-level security (§10.5)", () => {
    it("recomputes each widget against the caller's own RBAC scope, not the dashboard creator's", async () => {
      const dashboard = await createDashboard(owner, { name: "RLS Target" });
      await createDashboardWidget(owner, dashboard.id, {
        title: "Job count",
        entityType: "JOB",
        aggregate: "COUNT",
        filters: [],
        sortOrder: 0,
      });
      await createDashboardWidget(owner, dashboard.id, {
        title: "Positions sum",
        entityType: "JOB",
        aggregate: "SUM",
        fieldKey: "positionsCount",
        filters: [],
        sortOrder: 1,
      });

      // Owner has JOB:READ ALL — sees the seeded job.
      const asOwner = await getDashboardData(owner, dashboard.id);
      const ownerCount = asOwner.widgets.find((w) => w.title === "Job count")!.data[0].value;
      const ownerSum = asOwner.widgets.find((w) => w.title === "Positions sum")!.data[0].value;
      expect(ownerCount).toBeGreaterThanOrEqual(1);
      expect(ownerSum).toBeGreaterThanOrEqual(3);

      // jobRestrictedViewer has DASHBOARD:READ ALL (can view this same
      // dashboard) but only JOB:READ OWN with no jobs of their own — the
      // exact same widget definitions must compute to zero for them.
      const asRestrictedViewer = await getDashboardData(jobRestrictedViewer, dashboard.id);
      const restrictedCount = asRestrictedViewer.widgets.find((w) => w.title === "Job count")!.data[0].value;
      const restrictedSum = asRestrictedViewer.widgets.find((w) => w.title === "Positions sum")!.data[0].value;
      expect(restrictedCount).toBe(0);
      expect(restrictedSum).toBe(0);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("groups rows by the requested key", async () => {
      const dashboard = await createDashboard(owner, { name: "Grouping Target" });
      await createDashboardWidget(owner, dashboard.id, {
        title: "Jobs by status",
        entityType: "JOB",
        aggregate: "COUNT",
        groupByKey: "status",
        filters: [],
        sortOrder: 0,
      });

      const { widgets } = await getDashboardData(owner, dashboard.id);
      const grouped = widgets.find((w) => w.title === "Jobs by status")!;
      const openGroup = grouped.data.find((row) => row.group === "OPEN");
      expect(openGroup?.value).toBeGreaterThanOrEqual(1);

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });

    it("applies filters before aggregating", async () => {
      const dashboard = await createDashboard(owner, { name: "Filter Target" });
      await createDashboardWidget(owner, dashboard.id, {
        title: "Closed jobs",
        entityType: "JOB",
        aggregate: "COUNT",
        filters: [{ field: "status", operator: "EQUALS", value: "CLOSED" }],
        sortOrder: 0,
      });

      const { widgets } = await getDashboardData(owner, dashboard.id);
      expect(widgets[0].data[0].value).toBe(0); // the seeded job is OPEN, not CLOSED

      await prisma.dashboard.delete({ where: { id: dashboard.id } });
    });
  });
});
