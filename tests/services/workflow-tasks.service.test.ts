import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, ValidationError } from "@/lib/errors";
import { completeWorkflowTask, decideWorkflowTask, listWorkflowTasks } from "@/lib/services/workflow-tasks";
import { createJob } from "@/lib/services/jobs";
import { createCandidate } from "@/lib/services/candidates";
import { createApplication } from "@/lib/services/applications";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";

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

describe("WorkflowTaskService", () => {
  let ownerRoleId: string;
  let noAccessRoleId: string;

  let owner: SessionContext;
  let assignee: SessionContext;
  let otherAssignee: SessionContext;
  let unrelatedUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let jobId: string;
  let applicationId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const ownerRole = await prisma.role.create({
      data: {
        name: "Test WFTask Owner",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "READ", scope: "ALL" },
              { resource: "APPLICATION", action: "UPDATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    ownerRoleId = ownerRole.id;

    // No permissions at all — proves WorkflowTask's assignee path is
    // unconditional, unlike Interview's panelist path (see
    // assertWorkflowTaskAccess's own comment in workflow-tasks.ts).
    const noAccessRole = await prisma.role.create({ data: { name: "Test WFTask No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [ownerUser, assigneeUser, otherAssigneeUser, unrelatedUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "WFTask Owner", email: "wftask-owner@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFTask Assignee", email: "wftask-assignee@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFTask Other Assignee", email: "wftask-other-assignee@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "WFTask Unrelated", email: "wftask-unrelated@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: ownerUser.id, roleId: ownerRoleId },
        { userId: assigneeUser.id, roleId: noAccessRoleId },
        { userId: otherAssigneeUser.id, roleId: noAccessRoleId },
        { userId: unrelatedUserRow.id, roleId: noAccessRoleId },
      ],
    });

    owner = contextFor({ ...ownerUser, roles: [{ id: ownerRoleId, name: "Test WFTask Owner", isSuperAdmin: false }] });
    assignee = contextFor({ ...assigneeUser, roles: [{ id: noAccessRoleId, name: "Test WFTask No Access", isSuperAdmin: false }] });
    otherAssignee = contextFor({
      ...otherAssigneeUser,
      roles: [{ id: noAccessRoleId, name: "Test WFTask No Access", isSuperAdmin: false }],
    });
    unrelatedUser = contextFor({
      ...unrelatedUserRow,
      roles: [{ id: noAccessRoleId, name: "Test WFTask No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const job = await createJob(owner, {
      title: "Workflow Task Test Job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [owner.userId],
      primaryRecruiterUserId: owner.userId,
    } as JobCreateInput);
    jobId = job.id;

    const candidate = await createCandidate(owner, {
      name: "Task Candidate",
      phone: "+1 555-0700",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);

    const application = await createApplication(owner, { candidateId: candidate.id, jobId });
    applicationId = application.id;
  });

  afterAll(async () => {
    await prisma.workflowTask.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({ where: { id: applicationId } });
    await prisma.candidate.deleteMany({ where: { createdById: owner.userId } });
    await prisma.pipelineStage.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            "wftask-owner@test.local",
            "wftask-assignee@test.local",
            "wftask-other-assignee@test.local",
            "wftask-unrelated@test.local",
          ],
        },
      },
    });
    await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, noAccessRoleId] } } });
  });

  async function createTask(assignedToId: string, title = "Do the thing") {
    return prisma.workflowTask.create({ data: { applicationId, title, assignedToId } });
  }

  describe("completeWorkflowTask", () => {
    it("lets the assignee complete their own task even with zero Application permissions", async () => {
      const task = await createTask(assignee.userId);
      const completed = await completeWorkflowTask(assignee, task.id);
      expect(completed.status).toBe("DONE");
      expect(completed.completedAt).not.toBeNull();
    });

    it("lets whoever can manage the application (APPLICATION:UPDATE over its owner) complete a task assigned to someone else", async () => {
      const task = await createTask(otherAssignee.userId);
      const completed = await completeWorkflowTask(owner, task.id);
      expect(completed.status).toBe("DONE");
    });

    it("rejects a caller who is neither the assignee nor able to manage the application", async () => {
      const task = await createTask(otherAssignee.userId);
      await expect(completeWorkflowTask(unrelatedUser, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rejects completing a task that was already resolved", async () => {
      const task = await createTask(assignee.userId);
      await completeWorkflowTask(assignee, task.id);
      await expect(completeWorkflowTask(assignee, task.id)).rejects.toBeInstanceOf(ValidationError);
    });

    it("lets two concurrent completions race safely — exactly one wins, the loser gets ConflictError", async () => {
      const task = await createTask(assignee.userId);

      const results = await Promise.allSettled([
        completeWorkflowTask(assignee, task.id),
        completeWorkflowTask(assignee, task.id),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });
  });

  describe("decideWorkflowTask", () => {
    it("resolves to APPROVED or REJECTED depending on the outcome passed", async () => {
      const approveTask = await createTask(assignee.userId, "Approve this offer");
      const approved = await decideWorkflowTask(assignee, approveTask.id, "APPROVED");
      expect(approved.status).toBe("APPROVED");

      const rejectTask = await createTask(assignee.userId, "Approve this other offer");
      const rejected = await decideWorkflowTask(assignee, rejectTask.id, "REJECTED");
      expect(rejected.status).toBe("REJECTED");
    });
  });

  describe("listWorkflowTasks", () => {
    it("returns every task assigned to the caller across applications when applicationId is omitted", async () => {
      const task = await createTask(assignee.userId, "My tasks task");
      const tasks = await listWorkflowTasks(assignee, {});
      expect(tasks.some((row) => row.id === task.id)).toBe(true);
      expect(tasks.every((row) => row.assignedToId === assignee.userId)).toBe(true);
    });

    it("scopes by applicationId to whoever can read that application", async () => {
      const task = await createTask(assignee.userId, "App-scoped task");
      const tasks = await listWorkflowTasks(owner, { applicationId });
      expect(tasks.some((row) => row.id === task.id)).toBe(true);
    });

    it("rejects an applicationId query from someone who can't read the application", async () => {
      await expect(listWorkflowTasks(unrelatedUser, { applicationId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("filters by status", async () => {
      const openTask = await createTask(assignee.userId, "Still open");
      const doneTask = await createTask(assignee.userId, "Already done");
      await completeWorkflowTask(assignee, doneTask.id);

      const openOnly = await listWorkflowTasks(assignee, { status: "OPEN" });
      expect(openOnly.some((row) => row.id === openTask.id)).toBe(true);
      expect(openOnly.some((row) => row.id === doneTask.id)).toBe(false);
    });
  });
});
