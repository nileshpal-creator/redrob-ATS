import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  createWorkflowDefinition,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  rollbackWorkflowDefinition,
  updateWorkflowDefinition,
} from "@/lib/services/workflow-definitions";
import { createJob } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { WorkflowDefinitionCreateInput } from "@/lib/validations/workflow";

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

describe("WorkflowDefinitionService", () => {
  let recruiterRoleId: string;
  let managerRoleId: string;
  let reporteeRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let manager: SessionContext;
  let directReport: SessionContext;
  let unrelatedRecruiter: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let jobId: string;
  let stageId: string;
  let templateId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test WFDef Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "WORKFLOW_DEFINITION", action: "CREATE", scope: "ALL" },
              { resource: "WORKFLOW_DEFINITION", action: "READ", scope: "ALL" },
              { resource: "WORKFLOW_DEFINITION", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const managerRole = await prisma.role.create({
      data: {
        name: "Test WFDef Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "WORKFLOW_DEFINITION", action: "READ", scope: "TEAM" },
              { resource: "WORKFLOW_DEFINITION", action: "UPDATE", scope: "TEAM" },
            ],
          },
        },
      },
    });
    managerRoleId = managerRole.id;

    const reporteeRole = await prisma.role.create({
      data: {
        name: "Test WFDef Reportee",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "WORKFLOW_DEFINITION", action: "CREATE", scope: "ALL" },
              { resource: "WORKFLOW_DEFINITION", action: "READ", scope: "OWN" },
            ],
          },
        },
      },
    });
    reporteeRoleId = reporteeRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test WFDef No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, managerUser, reporteeUser, unrelatedUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "WFDef Recruiter", email: "wfdef-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFDef Manager", email: "wfdef-manager@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFDef Reportee", email: "wfdef-reportee@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFDef Unrelated", email: "wfdef-unrelated@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFDef No Access", email: "wfdef-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.user.update({ where: { id: reporteeUser.id }, data: { managerId: managerUser.id } });

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: managerUser.id, roleId: managerRoleId },
        { userId: reporteeUser.id, roleId: reporteeRoleId },
        { userId: unrelatedUser.id, roleId: reporteeRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test WFDef Recruiter", isSuperAdmin: false }] });
    manager = contextFor({ ...managerUser, roles: [{ id: managerRoleId, name: "Test WFDef Manager", isSuperAdmin: false }] });
    directReport = contextFor({ ...reporteeUser, roles: [{ id: reporteeRoleId, name: "Test WFDef Reportee", isSuperAdmin: false }] });
    unrelatedRecruiter = contextFor({ ...unrelatedUser, roles: [{ id: reporteeRoleId, name: "Test WFDef Reportee", isSuperAdmin: false }] });
    noAccessUser = contextFor({ ...noAccessUserRow, roles: [{ id: noAccessRoleId, name: "Test WFDef No Access", isSuperAdmin: false }] });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const job = await createJob(recruiter, {
      title: "Workflow Definition Test Job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    } as JobCreateInput);
    jobId = job.id;
    stageId = (await prisma.pipelineStage.findFirstOrThrow({ where: { jobId }, orderBy: { sortOrder: "asc" } })).id;

    const template = await prisma.communicationTemplate.create({
      data: {
        name: "WFDef Test Template",
        channel: "EMAIL",
        subject: "Hi",
        body: "Hello {{candidate.name}}",
        isActive: true,
        createdById: recruiter.userId,
      },
    });
    templateId = template.id;
  });

  afterAll(async () => {
    await prisma.workflowTask.deleteMany({});
    await prisma.workflowExecution.deleteMany({});
    await prisma.workflowDefinitionVersion.deleteMany({});
    await prisma.workflowDefinition.deleteMany({});
    await prisma.communicationTemplate.deleteMany({ where: { id: templateId } });
    await prisma.pipelineStage.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: [recruiterRoleId, managerRoleId, reporteeRoleId, noAccessRoleId] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            "wfdef-recruiter@test.local",
            "wfdef-manager@test.local",
            "wfdef-reportee@test.local",
            "wfdef-unrelated@test.local",
            "wfdef-noaccess@test.local",
          ],
        },
      },
    });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, managerRoleId, reporteeRoleId, noAccessRoleId] } } });
  });

  const emailInput = (overrides: Partial<WorkflowDefinitionCreateInput> = {}): WorkflowDefinitionCreateInput =>
    ({
      name: "Notify on new application",
      trigger: { type: "FORM_SUBMISSION", config: {} },
      conditions: [],
      actions: [{ type: "SEND_EMAIL", templateId }],
      ...overrides,
    }) as WorkflowDefinitionCreateInput;

  describe("createWorkflowDefinition", () => {
    it("creates a workflow with an initial version 1 and points activeVersionId at it", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());
      expect(created.version).toBe(0);
      expect(created.activeVersion?.versionNumber).toBe(1);
      expect(created.activeVersionId).toBe(created.activeVersion?.id);
    });

    it("rejects a STAGE_CHANGE trigger with no jobId — pipeline stages are job-scoped", async () => {
      await expect(
        createWorkflowDefinition(
          recruiter,
          emailInput({ trigger: { type: "STAGE_CHANGE", config: { toStageId: stageId } } }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts a STAGE_CHANGE trigger scoped to the job whose stage it names", async () => {
      const created = await createWorkflowDefinition(
        recruiter,
        emailInput({ jobId, trigger: { type: "STAGE_CHANGE", config: { toStageId: stageId } } }),
      );
      expect(created.jobId).toBe(jobId);
    });

    it("rejects a stage that doesn't belong to the given job", async () => {
      const otherJob = await createJob(recruiter, {
        title: "Other Job",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "MEDIUM",
        positionsCount: 1,
        mustHaveCriteria: [],
        goodToHaveCriteria: [],
        recruiterUserIds: [recruiter.userId],
        primaryRecruiterUserId: recruiter.userId,
      } as JobCreateInput);

      await expect(
        createWorkflowDefinition(
          recruiter,
          emailInput({ jobId: otherJob.id, trigger: { type: "STAGE_CHANGE", config: { toStageId: stageId } } }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      await prisma.pipelineStage.deleteMany({ where: { jobId: otherJob.id } });
      await prisma.job.delete({ where: { id: otherJob.id } });
    });

    it("rejects an inactive/unknown email template in a SEND_EMAIL action", async () => {
      await expect(
        createWorkflowDefinition(recruiter, emailInput({ actions: [{ type: "SEND_EMAIL", templateId: "not-a-real-id" }] })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects a caller with no WORKFLOW_DEFINITION:CREATE grant", async () => {
      await expect(createWorkflowDefinition(noAccessUser, emailInput())).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("updateWorkflowDefinition", () => {
    it("bumps the optimistic-locking version and keeps the same activeVersionId for a metadata-only edit", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());
      const updated = await updateWorkflowDefinition(recruiter, created.id, { version: created.version, isActive: false });
      expect(updated.version).toBe(created.version + 1);
      expect(updated.isActive).toBe(false);
      expect(updated.activeVersionId).toBe(created.activeVersionId);
    });

    it("creates a new WorkflowDefinitionVersion row and re-points activeVersionId when trigger/conditions/actions change", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());
      const updated = await updateWorkflowDefinition(recruiter, created.id, {
        version: created.version,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        conditions: [],
        actions: [{ type: "SEND_EMAIL", templateId }, { type: "REASSIGN_OWNER", userId: recruiter.userId }],
      });
      expect(updated.activeVersionId).not.toBe(created.activeVersionId);
      expect(updated.activeVersion?.versionNumber).toBe(2);

      const versions = await prisma.workflowDefinitionVersion.findMany({ where: { workflowDefinitionId: created.id } });
      expect(versions).toHaveLength(2);
    });

    it("rejects a stale version with ConflictError", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());
      await updateWorkflowDefinition(recruiter, created.id, { version: created.version, isActive: false });

      await expect(
        updateWorkflowDefinition(recruiter, created.id, { version: created.version, isActive: true }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("lets two concurrent updates race safely — exactly one wins, the loser gets ConflictError", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());

      const [first, second] = await Promise.allSettled([
        updateWorkflowDefinition(recruiter, created.id, { version: created.version, isActive: false }),
        updateWorkflowDefinition(recruiter, created.id, { version: created.version, name: "Renamed" }),
      ]);

      const outcomes = [first, second];
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });
  });

  describe("rollbackWorkflowDefinition", () => {
    it("re-points activeVersionId at an older version without deleting it, and bumps version", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());
      const v1Id = created.activeVersionId as string;

      const updated = await updateWorkflowDefinition(recruiter, created.id, {
        version: created.version,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        conditions: [],
        actions: [{ type: "REASSIGN_OWNER", userId: recruiter.userId }],
      });
      expect(updated.activeVersionId).not.toBe(v1Id);

      const rolledBack = await rollbackWorkflowDefinition(recruiter, created.id, {
        version: updated.version,
        targetVersionId: v1Id,
      });
      expect(rolledBack.activeVersionId).toBe(v1Id);
      expect(rolledBack.version).toBe(updated.version + 1);

      const versions = await prisma.workflowDefinitionVersion.findMany({ where: { workflowDefinitionId: created.id } });
      expect(versions).toHaveLength(2);
    });

    it("rejects a targetVersionId that belongs to a different workflow", async () => {
      const created = await createWorkflowDefinition(recruiter, emailInput());
      const other = await createWorkflowDefinition(recruiter, emailInput());

      await expect(
        rollbackWorkflowDefinition(recruiter, created.id, {
          version: created.version,
          targetVersionId: other.activeVersionId as string,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("RBAC scoping", () => {
    it("lets a manager read and update their direct report's workflow via TEAM scope", async () => {
      const created = await createWorkflowDefinition(directReport, emailInput({ name: "Reportee's workflow" }));

      const viaManager = await getWorkflowDefinition(manager, created.id);
      expect(viaManager.id).toBe(created.id);

      const updated = await updateWorkflowDefinition(manager, created.id, { version: created.version, isActive: false });
      expect(updated.isActive).toBe(false);
    });

    it("does not let an unrelated recruiter (no ALL/TEAM/OWN grant reaching this row) read it", async () => {
      const created = await createWorkflowDefinition(directReport, emailInput({ name: "Another reportee workflow" }));
      await expect(getWorkflowDefinition(unrelatedRecruiter, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("scopes listWorkflowDefinitions to only what the caller's grant covers", async () => {
      const own = await createWorkflowDefinition(unrelatedRecruiter, emailInput({ name: "Unrelated's own workflow" }));
      const list = await listWorkflowDefinitions(unrelatedRecruiter, {});
      expect(list.some((definition) => definition.id === own.id)).toBe(true);
    });

    it("rejects a caller with no WORKFLOW_DEFINITION:READ grant at all", async () => {
      await expect(listWorkflowDefinitions(noAccessUser, {})).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
