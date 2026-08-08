import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { WorkflowTaskQuery } from "@/lib/validations/workflow";

const userSummarySelect = { id: true, name: true, email: true } as const;

const workflowTaskInclude = {
  assignedTo: { select: userSummarySelect },
  application: {
    select: {
      id: true,
      ownerId: true,
      candidate: { select: { id: true, name: true } },
      job: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.WorkflowTaskInclude;

type WorkflowTaskWithApplication = Prisma.WorkflowTaskGetPayload<{ include: typeof workflowTaskInclude }>;

/**
 * Two independent access paths, the same shape Interview already uses for
 * scheduler-vs-panelist: whoever manages the application (APPLICATION:UPDATE
 * against its owner) can act on any of its tasks, OR the task's own assignee
 * can act on it regardless of their broader Application permissions — a
 * task assigned to a Hiring Manager (who may hold only APPLICATION:READ)
 * must still be completable by them, since REQUEST_APPROVAL exists
 * specifically to route a decision to someone outside the application's
 * normal owner/scope chain.
 */
async function assertWorkflowTaskAccess(context: SessionContext, task: WorkflowTaskWithApplication) {
  if (await can(context, ENTITY.APPLICATION, "UPDATE", { ownerId: task.application.ownerId })) return;
  if (task.assignedToId === context.userId) return;
  throw new ForbiddenError();
}

export async function listWorkflowTasks(context: SessionContext, query: WorkflowTaskQuery) {
  if (query.applicationId) {
    const application = await prisma.application.findUnique({
      where: { id: query.applicationId },
      select: { id: true, ownerId: true },
    });
    if (!application) {
      throw new NotFoundError("Application not found.");
    }
    const canReadAll = await can(context, ENTITY.APPLICATION, "READ");
    const canReadOwn = await can(context, ENTITY.APPLICATION, "READ", { ownerId: application.ownerId });
    if (!canReadAll && !canReadOwn) {
      throw new ForbiddenError();
    }
    return prisma.workflowTask.findMany({
      where: { applicationId: query.applicationId, status: query.status },
      include: workflowTaskInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  // No applicationId: "my tasks" — every task assigned to the caller,
  // across every application, regardless of the caller's broader
  // Application scope (see assertWorkflowTaskAccess's own reasoning).
  return prisma.workflowTask.findMany({
    where: { assignedToId: query.assignedToId ?? context.userId, status: query.status },
    include: workflowTaskInclude,
    orderBy: { createdAt: "desc" },
  });
}

async function resolveTask(id: string) {
  const task = await prisma.workflowTask.findUnique({ where: { id }, include: workflowTaskInclude });
  if (!task) {
    throw new NotFoundError("Task not found.");
  }
  return task;
}

/**
 * Guards on the task's *current* status, not a version column — the only
 * "conflict" that matters here is "did someone else already resolve this,"
 * which the status field itself captures; a status-guarded `updateMany` is
 * the same optimistic-concurrency shape as version-guarded updates
 * elsewhere, just keyed on status instead of an integer.
 */
async function resolveWorkflowTask(
  context: SessionContext,
  id: string,
  nextStatus: "DONE" | "APPROVED" | "REJECTED",
) {
  const task = await resolveTask(id);
  await assertWorkflowTaskAccess(context, task);
  if (task.status !== "OPEN") {
    throw new ValidationError("This task has already been resolved.");
  }

  const result = await prisma.workflowTask.updateMany({
    where: { id, status: "OPEN" },
    data: { status: nextStatus, completedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("This task was already resolved by someone else. Reload and try again.");
  }

  const updated = await prisma.workflowTask.findUniqueOrThrow({ where: { id }, include: workflowTaskInclude });

  // Logged against the Application, not a WORKFLOW_TASK resource — the
  // same "audit against the parent entity" convention pipeline-stages.ts
  // uses for PIPELINE_STAGES_UPDATED, since WorkflowTask reuses
  // APPLICATION's own permission rather than having one of its own.
  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.WORKFLOW_TASK_COMPLETED,
    entityType: ENTITY.APPLICATION,
    entityId: task.applicationId,
    changes: { before: { status: task.status }, after: { status: nextStatus, taskId: id, title: task.title } },
  });

  return updated;
}

export async function completeWorkflowTask(context: SessionContext, id: string) {
  return resolveWorkflowTask(context, id, "DONE");
}

export async function decideWorkflowTask(context: SessionContext, id: string, outcome: "APPROVED" | "REJECTED") {
  return resolveWorkflowTask(context, id, outcome);
}
