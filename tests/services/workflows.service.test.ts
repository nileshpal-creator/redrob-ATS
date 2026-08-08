import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { createWorkflowDefinition } from "@/lib/services/workflow-definitions";
import { evaluateApplicationWorkflows, runDueTimeInStageWorkflows } from "@/lib/services/workflows";
import { createJob } from "@/lib/services/jobs";
import { createCandidate } from "@/lib/services/candidates";
import { createApplication, transitionApplication, updateApplication } from "@/lib/services/applications";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";
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

describe("WorkflowService — engine and cross-module hooks", () => {
  let recruiterRoleId: string;

  let recruiter: SessionContext;
  let assignee: SessionContext;
  let newOwner: SessionContext;

  let departmentId: string;
  let locationId: string;
  let templateId: string;
  let scoreFieldKey: string;
  let flagFieldKey: string;

  const jobIds: string[] = [];
  const applicationIds: string[] = [];
  const candidateIds: string[] = [];

  const jobInput = (title: string): JobCreateInput =>
    ({
      title,
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 5,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    }) as JobCreateInput;

  /**
   * Every describe block below gets its OWN job (and default stage set) so
   * that a job-scoped active WorkflowDefinition created by one test can
   * never fire on an application created by a later, unrelated test — the
   * engine deliberately fires every matching active workflow on every
   * qualifying event, so sharing one job across tests would make later
   * assertions depend on execution order.
   */
  async function makeIsolatedJob(title: string) {
    const job = await createJob(recruiter, jobInput(title));
    jobIds.push(job.id);
    const stages = await prisma.pipelineStage.findMany({ where: { jobId: job.id }, orderBy: { sortOrder: "asc" } });
    return { jobId: job.id, stages };
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Workflows Recruiter",
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
              { resource: "WORKFLOW_DEFINITION", action: "CREATE", scope: "ALL" },
              { resource: "WORKFLOW_DEFINITION", action: "READ", scope: "ALL" },
              { resource: "WORKFLOW_DEFINITION", action: "UPDATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const [recruiterUser, assigneeUser, newOwnerUser] = await Promise.all([
      prisma.user.create({ data: { name: "Workflows Recruiter", email: "wf-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Workflows Assignee", email: "wf-assignee@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Workflows New Owner", email: "wf-newowner@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: assigneeUser.id, roleId: recruiterRoleId },
        { userId: newOwnerUser.id, roleId: recruiterRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Workflows Recruiter", isSuperAdmin: false }] });
    assignee = contextFor({ ...assigneeUser, roles: [{ id: recruiterRoleId, name: "Test Workflows Recruiter", isSuperAdmin: false }] });
    newOwner = contextFor({ ...newOwnerUser, roles: [{ id: recruiterRoleId, name: "Test Workflows Recruiter", isSuperAdmin: false }] });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const template = await prisma.communicationTemplate.create({
      data: {
        name: "Workflow Engine Test Template",
        channel: "EMAIL",
        subject: "Update",
        body: "Hi {{candidate.name}}",
        isActive: true,
        createdById: recruiterUser.id,
      },
    });
    templateId = template.id;

    const scoreField = await prisma.customFieldDefinition.create({
      data: { entityType: "APPLICATION", key: "score", label: "Score", fieldType: "NUMBER", isActive: true },
    });
    scoreFieldKey = scoreField.key;

    const flagField = await prisma.customFieldDefinition.create({
      data: { entityType: "APPLICATION", key: "priority_flag", label: "Priority Flag", fieldType: "TEXT", isActive: true },
    });
    flagFieldKey = flagField.key;
  });

  afterAll(async () => {
    await prisma.workflowTask.deleteMany({});
    await prisma.workflowExecution.deleteMany({});
    await prisma.workflowDefinitionVersion.deleteMany({});
    await prisma.workflowDefinition.deleteMany({});
    await prisma.applicationEmailLog.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
    await prisma.customFieldDefinition.deleteMany({ where: { entityType: "APPLICATION", key: { in: [scoreFieldKey, flagFieldKey] } } });
    await prisma.communicationTemplate.deleteMany({ where: { id: templateId } });
    await prisma.pipelineStage.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: recruiterRoleId } });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            "wf-recruiter@test.local",
            "wf-assignee@test.local",
            "wf-newowner@test.local",
            "wf-soon-inactive@test.local",
          ],
        },
      },
    });
    await prisma.role.deleteMany({ where: { id: recruiterRoleId } });
  });

  async function makeCandidate(phone: string) {
    const candidate = await createCandidate(recruiter, {
      name: "Workflow Candidate",
      phone,
      email: "wf-candidate@example.com",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
    candidateIds.push(candidate.id);
    return candidate;
  }

  async function makeApplication(targetJobId: string, phone: string, customFields?: Record<string, unknown>) {
    const candidate = await makeCandidate(phone);
    const application = await createApplication(recruiter, { candidateId: candidate.id, jobId: targetJobId, customFields });
    applicationIds.push(application.id);
    return application;
  }

  async function makeWorkflow(input: Partial<WorkflowDefinitionCreateInput>) {
    return createWorkflowDefinition(recruiter, {
      name: "Test workflow",
      conditions: [],
      ...input,
    } as WorkflowDefinitionCreateInput);
  }

  describe("STAGE_CHANGE trigger (via transitionApplication)", () => {
    it("sends the configured email when the application moves to the configured destination stage", async () => {
      const { jobId, stages } = await makeIsolatedJob("Workflow Engine — Stage Change A");
      await makeWorkflow({
        jobId,
        trigger: { type: "STAGE_CHANGE", config: { toStageId: stages[1].id } },
        actions: [{ type: "SEND_EMAIL", templateId }],
      });

      const application = await makeApplication(jobId, "+1 555-1001");
      await transitionApplication(recruiter, application.id, {
        action: "STAGE_MOVE",
        toStageId: stages[1].id,
        version: application.version,
      });

      const log = await prisma.applicationEmailLog.findFirst({ where: { applicationId: application.id } });
      expect(log?.status).toBe("SENT");
    });

    it("does not fire for a move to a different stage than the one configured", async () => {
      const { jobId, stages } = await makeIsolatedJob("Workflow Engine — Stage Change B");
      await makeWorkflow({
        jobId,
        trigger: { type: "STAGE_CHANGE", config: { toStageId: stages[1].id } },
        actions: [{ type: "SEND_EMAIL", templateId }],
      });

      const application = await makeApplication(jobId, "+1 555-1002");
      await transitionApplication(recruiter, application.id, {
        action: "STAGE_MOVE",
        toStageId: stages[2].id,
        version: application.version,
      });

      const log = await prisma.applicationEmailLog.findFirst({ where: { applicationId: application.id } });
      expect(log).toBeNull();
    });
  });

  describe("FIELD_UPDATE trigger (via updateApplication)", () => {
    it("creates a task only when the configured field's value actually changes", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Field Update A");
      await makeWorkflow({
        jobId,
        trigger: { type: "FIELD_UPDATE", config: { fieldKey: flagFieldKey } },
        actions: [{ type: "CREATE_TASK", title: "Follow up on priority flag", assignedToId: assignee.userId }],
      });

      const application = await makeApplication(jobId, "+1 555-1003");

      const firstUpdate = await updateApplication(recruiter, application.id, {
        version: application.version,
        customFields: { [flagFieldKey]: "hot" },
      });
      expect(await prisma.workflowTask.count({ where: { applicationId: application.id } })).toBe(1);

      // Re-saving the same value is not a change — must not create a second task.
      await updateApplication(recruiter, application.id, {
        version: firstUpdate.version,
        customFields: { [flagFieldKey]: "hot" },
      });
      expect(await prisma.workflowTask.count({ where: { applicationId: application.id } })).toBe(1);
    });

    it("does not fire when a different field changes", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Field Update B");
      await makeWorkflow({
        jobId,
        trigger: { type: "FIELD_UPDATE", config: { fieldKey: flagFieldKey } },
        actions: [{ type: "CREATE_TASK", title: "Should not appear", assignedToId: assignee.userId }],
      });

      const application = await makeApplication(jobId, "+1 555-1004");
      await updateApplication(recruiter, application.id, { version: application.version, customFields: { [scoreFieldKey]: 42 } });

      expect(await prisma.workflowTask.count({ where: { applicationId: application.id } })).toBe(0);
    });
  });

  describe("FORM_SUBMISSION trigger (via createApplication)", () => {
    it("reassigns the owner immediately after a new application is submitted", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Form Submission A");
      await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "REASSIGN_OWNER", userId: newOwner.userId }],
      });

      const application = await makeApplication(jobId, "+1 555-1005");
      // The value createApplication returns is a pre-hook snapshot (the hook
      // runs after that row was already read) — re-fetch to see the effect.
      const fresh = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect(fresh.ownerId).toBe(newOwner.userId);
    });

    it("does not fire a workflow scoped to a different job", async () => {
      const { jobId: targetJobId } = await makeIsolatedJob("Workflow Engine — Form Submission B target");
      const { jobId: otherJobId } = await makeIsolatedJob("Workflow Engine — Form Submission B other");
      await makeWorkflow({
        jobId: otherJobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "CREATE_TASK", title: "Should not appear for targetJobId application", assignedToId: assignee.userId }],
      });

      const application = await makeApplication(targetJobId, "+1 555-1006");
      expect(await prisma.workflowTask.count({ where: { applicationId: application.id } })).toBe(0);
    });

    it("does not fire when the workflow is inactive", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Form Submission C");
      const workflow = await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "CREATE_TASK", title: "Should not appear — inactive", assignedToId: assignee.userId }],
      });
      await prisma.workflowDefinition.update({ where: { id: workflow.id }, data: { isActive: false } });

      const application = await makeApplication(jobId, "+1 555-1007");
      expect(await prisma.workflowTask.count({ where: { applicationId: application.id } })).toBe(0);
    });

    it("fires a global (no jobId) workflow for applications on any job", async () => {
      const { jobId: jobA } = await makeIsolatedJob("Workflow Engine — Global A");
      const { jobId: jobB } = await makeIsolatedJob("Workflow Engine — Global B");
      const workflow = await makeWorkflow({
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "CREATE_TASK", title: "Global reminder", assignedToId: assignee.userId }],
      });

      const applicationA = await makeApplication(jobA, "+1 555-1008");
      const applicationB = await makeApplication(jobB, "+1 555-1009");

      expect(await prisma.workflowTask.count({ where: { applicationId: applicationA.id, title: "Global reminder" } })).toBe(1);
      expect(await prisma.workflowTask.count({ where: { applicationId: applicationB.id, title: "Global reminder" } })).toBe(1);

      // Deactivate immediately — a global workflow left active would fire on
      // every application created by every test after this one in this file.
      await prisma.workflowDefinition.update({ where: { id: workflow.id }, data: { isActive: false } });
    });
  });

  describe("conditions", () => {
    async function fireOnCreate(operator: "EQUALS" | "NOT_EQUALS" | "GREATER_THAN" | "LESS_THAN" | "CONTAINS", value: string | number, field: string, phone: string, customFields: Record<string, unknown>) {
      const { jobId } = await makeIsolatedJob(`Workflow Engine — Condition ${operator} ${phone}`);
      const workflow = await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        conditions: [{ field, operator, value }],
        actions: [{ type: "CREATE_TASK", title: `Condition:${operator}`, assignedToId: assignee.userId }],
      });
      const application = await makeApplication(jobId, phone, customFields);
      return prisma.workflowTask.count({ where: { applicationId: application.id, sourceVersionId: workflow.activeVersionId } });
    }

    it("EQUALS fires only on an exact match", async () => {
      expect(await fireOnCreate("EQUALS", 5, scoreFieldKey, "+1 555-1101", { [scoreFieldKey]: 5 })).toBe(1);
      expect(await fireOnCreate("EQUALS", 5, scoreFieldKey, "+1 555-1102", { [scoreFieldKey]: 6 })).toBe(0);
    });

    it("NOT_EQUALS fires only when the value differs", async () => {
      expect(await fireOnCreate("NOT_EQUALS", 5, scoreFieldKey, "+1 555-1103", { [scoreFieldKey]: 6 })).toBe(1);
      expect(await fireOnCreate("NOT_EQUALS", 5, scoreFieldKey, "+1 555-1104", { [scoreFieldKey]: 5 })).toBe(0);
    });

    it("GREATER_THAN fires only when the numeric field exceeds the value", async () => {
      expect(await fireOnCreate("GREATER_THAN", 5, scoreFieldKey, "+1 555-1105", { [scoreFieldKey]: 10 })).toBe(1);
      expect(await fireOnCreate("GREATER_THAN", 5, scoreFieldKey, "+1 555-1106", { [scoreFieldKey]: 3 })).toBe(0);
    });

    it("LESS_THAN fires only when the numeric field is below the value", async () => {
      expect(await fireOnCreate("LESS_THAN", 5, scoreFieldKey, "+1 555-1107", { [scoreFieldKey]: 3 })).toBe(1);
      expect(await fireOnCreate("LESS_THAN", 5, scoreFieldKey, "+1 555-1108", { [scoreFieldKey]: 10 })).toBe(0);
    });

    it("CONTAINS fires only when the string field contains the substring", async () => {
      expect(await fireOnCreate("CONTAINS", "hot", flagFieldKey, "+1 555-1109", { [flagFieldKey]: "super-hot-lead" })).toBe(1);
      expect(await fireOnCreate("CONTAINS", "hot", flagFieldKey, "+1 555-1110", { [flagFieldKey]: "cold" })).toBe(0);
    });

    it("requires every condition to hold (AND-only)", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — AND condition");
      const workflow = await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        conditions: [
          { field: scoreFieldKey, operator: "GREATER_THAN", value: 5 },
          { field: flagFieldKey, operator: "EQUALS", value: "hot" },
        ],
        actions: [{ type: "CREATE_TASK", title: "AND condition", assignedToId: assignee.userId }],
      });

      const bothMatch = await makeApplication(jobId, "+1 555-1111", { [scoreFieldKey]: 10, [flagFieldKey]: "hot" });
      const onlyOneMatches = await makeApplication(jobId, "+1 555-1112", { [scoreFieldKey]: 10, [flagFieldKey]: "cold" });

      expect(
        await prisma.workflowTask.count({ where: { applicationId: bothMatch.id, sourceVersionId: workflow.activeVersionId } }),
      ).toBe(1);
      expect(
        await prisma.workflowTask.count({ where: { applicationId: onlyOneMatches.id, sourceVersionId: workflow.activeVersionId } }),
      ).toBe(0);
    });
  });

  describe("actions", () => {
    it("CHANGE_FIELD updates only the named custom field, bumping the application's version", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Change Field");
      await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "CHANGE_FIELD", fieldKey: flagFieldKey, value: "auto-flagged" }],
      });

      const application = await makeApplication(jobId, "+1 555-1201", { [scoreFieldKey]: 7 });
      const fresh = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect((fresh.customFields as Record<string, unknown>)[flagFieldKey]).toBe("auto-flagged");
      expect((fresh.customFields as Record<string, unknown>)[scoreFieldKey]).toBe(7);
      expect(fresh.version).toBe(application.version + 1);
    });

    it("REQUEST_APPROVAL creates a WorkflowTask assigned to the approver", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Request Approval");
      await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "REQUEST_APPROVAL", title: "Approve candidate", approverId: assignee.userId }],
      });

      const application = await makeApplication(jobId, "+1 555-1202");
      const task = await prisma.workflowTask.findFirst({ where: { applicationId: application.id, title: "Approve candidate" } });
      expect(task?.assignedToId).toBe(assignee.userId);
      expect(task?.status).toBe("OPEN");
    });

    it("records PARTIAL_FAILURE and still applies the succeeding action when one action fails", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Partial Failure");

      // assertActionsValid checks the target user is active at workflow
      // save time — to reach the runtime failure path in executeReassignOwner
      // (assertActiveUser called again at fire time), the user must go
      // inactive only *after* the workflow was created.
      const passwordHash = await bcrypt.hash("Test123!Test123!", 4);
      const toBeDeactivated = await prisma.user.create({
        data: { name: "Soon Inactive", email: "wf-soon-inactive@test.local", passwordHash },
      });

      const workflow = await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [
          { type: "SEND_EMAIL", templateId },
          { type: "REASSIGN_OWNER", userId: toBeDeactivated.id },
        ],
      });

      await prisma.user.update({ where: { id: toBeDeactivated.id }, data: { isActive: false } });

      const application = await makeApplication(jobId, "+1 555-1203");

      const log = await prisma.applicationEmailLog.findFirst({ where: { applicationId: application.id } });
      expect(log?.status).toBe("SENT");

      const execution = await prisma.workflowExecution.findFirstOrThrow({
        where: { workflowDefinitionVersionId: workflow.activeVersionId as string, applicationId: application.id },
      });
      expect(execution.status).toBe("PARTIAL_FAILURE");
    });
  });

  describe("idempotency (WorkflowExecution ledger)", () => {
    it("does not re-run the same trigger occurrence twice for the same fingerprint", async () => {
      const { jobId } = await makeIsolatedJob("Workflow Engine — Idempotency");
      const workflow = await makeWorkflow({
        jobId,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        actions: [{ type: "CREATE_TASK", title: "Idempotency check", assignedToId: assignee.userId }],
      });

      const application = await makeApplication(jobId, "+1 555-1301");
      const fingerprint = "fixed-fingerprint-for-test";

      await evaluateApplicationWorkflows(recruiter, application.id, "FORM_SUBMISSION", () => true, fingerprint);
      await evaluateApplicationWorkflows(recruiter, application.id, "FORM_SUBMISSION", () => true, fingerprint);

      // makeApplication's own FORM_SUBMISSION hook already fired once (its
      // own fingerprint is application.id) — the two identical-fingerprint
      // calls above must contribute at most one more.
      const tasks = await prisma.workflowTask.count({
        where: { applicationId: application.id, sourceVersionId: workflow.activeVersionId, title: "Idempotency check" },
      });
      expect(tasks).toBe(2);

      const executions = await prisma.workflowExecution.count({
        where: { workflowDefinitionVersionId: workflow.activeVersionId as string, applicationId: application.id, fingerprint },
      });
      expect(executions).toBe(1);
    });
  });

  describe("TIME_IN_STAGE trigger (via runDueTimeInStageWorkflows)", () => {
    it("fires for applications that have been in the configured stage past the threshold, and does not double-fire on a repeat call", async () => {
      const { jobId, stages } = await makeIsolatedJob("Workflow Engine — Time In Stage A");
      await makeWorkflow({
        jobId,
        trigger: { type: "TIME_IN_STAGE", config: { stageId: stages[0].id, days: 1 } },
        actions: [{ type: "CHANGE_FIELD", fieldKey: flagFieldKey, value: "stale" }],
      });

      const application = await makeApplication(jobId, "+1 555-1401", { [flagFieldKey]: "fresh" });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await prisma.application.update({ where: { id: application.id }, data: { stageEnteredAt: twoDaysAgo } });

      await runDueTimeInStageWorkflows();
      const afterFirst = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect((afterFirst.customFields as Record<string, unknown>)[flagFieldKey]).toBe("stale");

      await runDueTimeInStageWorkflows();
      const executionCount = await prisma.workflowExecution.count({ where: { applicationId: application.id } });
      expect(executionCount).toBe(1);
    });

    it("does not fire for an application that hasn't been in the stage long enough", async () => {
      const { jobId, stages } = await makeIsolatedJob("Workflow Engine — Time In Stage B");
      await makeWorkflow({
        jobId,
        trigger: { type: "TIME_IN_STAGE", config: { stageId: stages[0].id, days: 30 } },
        actions: [{ type: "CHANGE_FIELD", fieldKey: flagFieldKey, value: "should-not-apply" }],
      });

      const application = await makeApplication(jobId, "+1 555-1402", { [flagFieldKey]: "fresh" });
      await runDueTimeInStageWorkflows();

      const fresh = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect((fresh.customFields as Record<string, unknown>)[flagFieldKey]).toBe("fresh");
    });
  });
});
