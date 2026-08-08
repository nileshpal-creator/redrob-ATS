import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ValidationError } from "@/lib/errors";
import { listApprovalStepConfigs, replaceApprovalStepConfigs } from "@/lib/services/approvals";

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

describe("ApprovalsService", () => {
  let allScopeRoleId: string;
  let ownScopeRoleId: string;
  let noAccessRoleId: string;
  let approverRoleId: string;

  let allScopeUser: SessionContext;
  let ownScopeUser: SessionContext;
  let noAccessUser: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const allScopeRole = await prisma.role.create({
      data: {
        name: "Test Approvals Admin",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "ALL" },
              { resource: "OFFER", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "UPDATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    allScopeRoleId = allScopeRole.id;

    // OWN-scope JOB:UPDATE — enough to edit their own jobs, not enough to
    // reconfigure the org-wide approval chain (see assertAllScopeUpdate).
    const ownScopeRole = await prisma.role.create({
      data: {
        name: "Test Approvals Own Scope",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "READ", scope: "OWN" },
              { resource: "JOB", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    ownScopeRoleId = ownScopeRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Approvals No Access" } });
    noAccessRoleId = noAccessRole.id;

    // A plain role usable as a step's requiredRoleId in tests below.
    const approverRole = await prisma.role.create({ data: { name: "Test Approvals Step Approver" } });
    approverRoleId = approverRole.id;

    const [allScopeUserRow, ownScopeUserRow, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Approvals Admin", email: "approvals-admin@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Approvals Own Scope", email: "approvals-own@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Approvals No Access", email: "approvals-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: allScopeUserRow.id, roleId: allScopeRoleId },
        { userId: ownScopeUserRow.id, roleId: ownScopeRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    allScopeUser = contextFor({ ...allScopeUserRow, roles: [{ id: allScopeRoleId, name: "Test Approvals Admin", isSuperAdmin: false }] });
    ownScopeUser = contextFor({
      ...ownScopeUserRow,
      roles: [{ id: ownScopeRoleId, name: "Test Approvals Own Scope", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Approvals No Access", isSuperAdmin: false }],
    });
  });

  afterEach(async () => {
    await prisma.approvalStepConfig.deleteMany({ where: { entityType: { in: ["JOB", "OFFER"] } } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "APPROVAL_STEP_CONFIG" } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [allScopeRoleId, ownScopeRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["approvals-admin@test.local", "approvals-own@test.local", "approvals-noaccess@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [allScopeRoleId, ownScopeRoleId, noAccessRoleId, approverRoleId] } } });
  });

  describe("listApprovalStepConfigs", () => {
    it("returns an empty list when no chain is configured", async () => {
      const steps = await listApprovalStepConfigs(allScopeUser, "JOB");
      expect(steps).toEqual([]);
    });

    it("returns configured steps ordered by stepOrder, with the role name denormalized", async () => {
      await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [
          { stepOrder: 1, name: "Step One", requiredRoleId: approverRoleId },
          { stepOrder: 2, name: "Step Two", requiredRoleId: approverRoleId },
        ],
      });

      const steps = await listApprovalStepConfigs(ownScopeUser, "JOB");
      expect(steps.map((step) => step.stepOrder)).toEqual([1, 2]);
      expect(steps[0].requiredRole.name).toBe("Test Approvals Step Approver");
    });

    it("throws ForbiddenError for a caller with no JOB grant at all", async () => {
      await expect(listApprovalStepConfigs(noAccessUser, "JOB")).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("replaceApprovalStepConfigs", () => {
    it("creates a fresh chain and returns it", async () => {
      const result = await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [{ stepOrder: 1, name: "Only Step", requiredRoleId: approverRoleId }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Only Step");
    });

    it("fully replaces an existing chain rather than merging", async () => {
      await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [
          { stepOrder: 1, name: "Old Step One", requiredRoleId: approverRoleId },
          { stepOrder: 2, name: "Old Step Two", requiredRoleId: approverRoleId },
        ],
      });

      const replaced = await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [{ stepOrder: 1, name: "New Step", requiredRoleId: approverRoleId }],
      });
      expect(replaced).toHaveLength(1);
      expect(replaced[0].name).toBe("New Step");
    });

    it("clears the chain entirely when given an empty steps array", async () => {
      await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [{ stepOrder: 1, name: "Step", requiredRoleId: approverRoleId }],
      });
      const cleared = await replaceApprovalStepConfigs(allScopeUser, "JOB", { steps: [] });
      expect(cleared).toEqual([]);
    });

    it("JOB and OFFER chains are independent — replacing one leaves the other untouched", async () => {
      await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [{ stepOrder: 1, name: "Job Step", requiredRoleId: approverRoleId }],
      });
      await replaceApprovalStepConfigs(allScopeUser, "OFFER", {
        steps: [{ stepOrder: 1, name: "Offer Step", requiredRoleId: approverRoleId }],
      });

      const jobSteps = await listApprovalStepConfigs(allScopeUser, "JOB");
      const offerSteps = await listApprovalStepConfigs(allScopeUser, "OFFER");
      expect(jobSteps).toHaveLength(1);
      expect(jobSteps[0].name).toBe("Job Step");
      expect(offerSteps).toHaveLength(1);
      expect(offerSteps[0].name).toBe("Offer Step");
    });

    it("rejects a requiredRoleId that doesn't match an existing role", async () => {
      await expect(
        replaceApprovalStepConfigs(allScopeUser, "JOB", {
          steps: [{ stepOrder: 1, name: "Step", requiredRoleId: "nonexistent-role-id" }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      // The rejected write must not have partially applied.
      expect(await listApprovalStepConfigs(allScopeUser, "JOB")).toEqual([]);
    });

    it("throws ForbiddenError for a caller with only OWN-scope JOB:UPDATE — configuring the chain requires ALL scope", async () => {
      await expect(
        replaceApprovalStepConfigs(ownScopeUser, "JOB", {
          steps: [{ stepOrder: 1, name: "Step", requiredRoleId: approverRoleId }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ForbiddenError for a caller with no JOB grant at all", async () => {
      await expect(
        replaceApprovalStepConfigs(noAccessUser, "JOB", {
          steps: [{ stepOrder: 1, name: "Step", requiredRoleId: approverRoleId }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("records an audit log entry with before/after step lists", async () => {
      await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [{ stepOrder: 1, name: "Step A", requiredRoleId: approverRoleId }],
      });
      await replaceApprovalStepConfigs(allScopeUser, "JOB", {
        steps: [{ stepOrder: 1, name: "Step B", requiredRoleId: approverRoleId }],
      });

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "APPROVAL_STEP_CONFIG", action: "approval_step_config.updated" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry).not.toBeNull();
      const changes = entry?.changes as { before: { name: string }[]; after: { name: string }[] };
      expect(changes.before[0].name).toBe("Step A");
      expect(changes.after[0].name).toBe("Step B");
    });
  });
});
