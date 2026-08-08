import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { WorkflowExecutionStatus, WorkflowTriggerType } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import type { SessionContext } from "@/lib/authz/session-context";
import { getSessionContextForUser } from "@/lib/authz/session-context-for-user";
import { ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { renderTemplate } from "@/lib/templates/render";
import { getActiveCommunicationTemplateOrThrow } from "@/lib/services/communication-templates";
import { getMailProvider } from "@/lib/mail";
import type { WorkflowAction, WorkflowCondition } from "@/lib/validations/workflow";

const DAY_MS = 24 * 60 * 60 * 1000;

// Module 12: bounds how many stale applications one TIME_IN_STAGE
// definition's due-check considers per call — a large backlog is worked
// off over several scheduler ticks rather than in one unbounded pass.
const MAX_APPLICATIONS_PER_DEFINITION_PER_RUN = 200;

const applicationForWorkflowSelect = {
  id: true,
  jobId: true,
  ownerId: true,
  stageId: true,
  stageEnteredAt: true,
  customFields: true,
  version: true,
  candidate: { select: { name: true, email: true } },
  job: { select: { title: true } },
} satisfies Prisma.ApplicationSelect;

type ApplicationForWorkflow = Prisma.ApplicationGetPayload<{ select: typeof applicationForWorkflowSelect }>;

async function assertActiveUser(userId: string, fieldLabel: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user || !user.isActive) {
    throw new ValidationError(`${fieldLabel} must be an active user.`);
  }
}

function evaluateCondition(condition: WorkflowCondition, customFields: Record<string, unknown>): boolean {
  const actual = customFields[condition.field];
  switch (condition.operator) {
    case "EQUALS":
      return actual !== undefined && actual !== null && String(actual) === String(condition.value);
    case "NOT_EQUALS":
      return !(actual !== undefined && actual !== null && String(actual) === String(condition.value));
    case "GREATER_THAN":
      return typeof actual === "number" && actual > Number(condition.value);
    case "LESS_THAN":
      return typeof actual === "number" && actual < Number(condition.value);
    case "CONTAINS":
      return typeof actual === "string" && actual.includes(String(condition.value));
    default:
      return false;
  }
}

/** AND-only — see the WorkflowDefinitionVersion model comment for why. */
function evaluateConditions(conditions: WorkflowCondition[], customFields: Record<string, unknown>): boolean {
  return conditions.every((condition) => evaluateCondition(condition, customFields));
}

async function executeSendEmail(
  context: SessionContext,
  application: ApplicationForWorkflow,
  action: Extract<WorkflowAction, { type: "SEND_EMAIL" }>,
) {
  const template = await getActiveCommunicationTemplateOrThrow(action.templateId);
  if (!application.candidate.email) {
    throw new ValidationError("Candidate has no email on file.");
  }

  const provider = getMailProvider();
  const renderContext = { "candidate.name": application.candidate.name, "job.title": application.job.title };
  const subject = renderTemplate(template.subject, renderContext);
  const body = renderTemplate(template.body, renderContext);
  const result = await provider.send({ to: application.candidate.email, subject, body });

  await prisma.applicationEmailLog.create({
    data: {
      applicationId: application.id,
      templateId: template.id,
      toEmail: application.candidate.email,
      subject,
      body,
      status: result.success ? "SENT" : "FAILED",
      requestedById: context.userId,
      sentAt: result.success ? new Date() : null,
    },
  });

  if (!result.success) {
    throw new Error(result.errorMessage ?? "Email delivery failed.");
  }
}

async function executeCreateTask(
  application: ApplicationForWorkflow,
  action: Extract<WorkflowAction, { type: "CREATE_TASK" }>,
  sourceVersionId: string,
) {
  await assertActiveUser(action.assignedToId, "Task assignee");
  await prisma.workflowTask.create({
    data: {
      applicationId: application.id,
      title: action.title,
      description: action.description,
      assignedToId: action.assignedToId,
      dueAt: action.dueInDays ? new Date(Date.now() + action.dueInDays * DAY_MS) : null,
      sourceVersionId,
    },
  });
}

async function executeRequestApproval(
  application: ApplicationForWorkflow,
  action: Extract<WorkflowAction, { type: "REQUEST_APPROVAL" }>,
  sourceVersionId: string,
) {
  await assertActiveUser(action.approverId, "Approver");
  await prisma.workflowTask.create({
    data: {
      applicationId: application.id,
      title: action.title,
      description: action.description,
      assignedToId: action.approverId,
      sourceVersionId,
    },
  });
}

/**
 * `customFields` only — Application's core lifecycle fields (stageId/
 * outcome/ownerId) keep their own state-machine-guarded paths; see the
 * WorkflowDefinitionVersion model comment. Re-reads the current row
 * immediately before writing (not the possibly-stale `application` the
 * caller passed in) to keep the version-conflict window as small as
 * practical for an action running well after the triggering write
 * committed.
 */
async function executeChangeField(application: ApplicationForWorkflow, action: Extract<WorkflowAction, { type: "CHANGE_FIELD" }>) {
  const definition = await prisma.customFieldDefinition.findFirst({
    where: { entityType: ENTITY.APPLICATION, key: action.fieldKey, isActive: true },
  });
  if (!definition) {
    throw new ValidationError(`Unknown or inactive custom field "${action.fieldKey}".`);
  }

  const current = await prisma.application.findUniqueOrThrow({
    where: { id: application.id },
    select: { customFields: true, version: true },
  });
  const nextCustomFields = { ...((current.customFields as Record<string, unknown>) ?? {}), [action.fieldKey]: action.value };

  const result = await prisma.application.updateMany({
    where: { id: application.id, version: current.version },
    data: { customFields: nextCustomFields as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new Error("Application was updated concurrently; field change was not applied.");
  }
}

async function executeReassignOwner(application: ApplicationForWorkflow, action: Extract<WorkflowAction, { type: "REASSIGN_OWNER" }>) {
  await assertActiveUser(action.userId, "New owner");
  const current = await prisma.application.findUniqueOrThrow({ where: { id: application.id }, select: { version: true } });
  const result = await prisma.application.updateMany({
    where: { id: application.id, version: current.version },
    data: { ownerId: action.userId, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new Error("Application was updated concurrently; owner reassignment was not applied.");
  }
}

type ActionResult = { type: string; success: boolean; error?: string };

async function runAction(
  context: SessionContext,
  application: ApplicationForWorkflow,
  action: WorkflowAction,
  sourceVersionId: string,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "SEND_EMAIL":
        await executeSendEmail(context, application, action);
        break;
      case "CREATE_TASK":
        await executeCreateTask(application, action, sourceVersionId);
        break;
      case "CHANGE_FIELD":
        await executeChangeField(application, action);
        break;
      case "REASSIGN_OWNER":
        await executeReassignOwner(application, action);
        break;
      case "REQUEST_APPROVAL":
        await executeRequestApproval(application, action, sourceVersionId);
        break;
    }
    return { type: action.type, success: true };
  } catch (error) {
    return { type: action.type, success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Atomically claims the (version, application, fingerprint) slot via the
 * unique index on WorkflowExecution — the real guard against running the
 * same occurrence of a trigger twice (concurrent evaluations, or repeated
 * runDueTimeInStageWorkflows calls while an application sits in the same
 * stage), the same "let the database's unique constraint be the guard, not
 * a check-then-act pre-check" pattern createOffer/createCommunicationTemplate
 * already establish. Returns null if another evaluation already claimed it.
 */
async function claimExecutionSlot(
  workflowDefinitionVersionId: string,
  applicationId: string,
  fingerprint: string,
): Promise<string | null> {
  const claimed = await prisma.workflowExecution
    .create({
      data: { workflowDefinitionVersionId, applicationId, fingerprint, status: "FAILED", actionsSummary: [] },
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return null;
      }
      throw error;
    });
  return claimed?.id ?? null;
}

async function runActionsAndFinalize(
  context: SessionContext,
  application: ApplicationForWorkflow,
  version: { id: string; workflowDefinitionId: string; triggerType: WorkflowTriggerType; actions: Prisma.JsonValue },
  executionId: string,
) {
  const actions = version.actions as unknown as WorkflowAction[];
  const results: ActionResult[] = [];
  for (const action of actions) {
    results.push(await runAction(context, application, action, version.id));
  }

  const successCount = results.filter((result) => result.success).length;
  const status: WorkflowExecutionStatus =
    successCount === results.length ? "SUCCESS" : successCount === 0 ? "FAILED" : "PARTIAL_FAILURE";

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status,
      actionsSummary: results as unknown as Prisma.InputJsonValue,
      errorMessage: results.find((result) => !result.success)?.error,
    },
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.WORKFLOW_EXECUTED,
    entityType: ENTITY.WORKFLOW_DEFINITION,
    entityId: version.workflowDefinitionId,
    changes: { after: { applicationId: application.id, triggerType: version.triggerType, status, results } },
  });
}

type WorkflowVersionRow = Prisma.WorkflowDefinitionVersionGetPayload<Record<string, never>>;

/**
 * The one entry point every event-driven trigger hook calls (STAGE_CHANGE
 * from transitionApplication, FIELD_UPDATE from updateApplication,
 * FORM_SUBMISSION from createApplication — see src/lib/services/
 * applications.ts). Runs *after* the triggering write has already
 * committed, deliberately outside that write's own transaction: SEND_EMAIL
 * is external I/O, and a misbehaving automation must never roll back or
 * fail the user's own action that triggered it — a per-action try/catch in
 * runAction is what keeps one bad action from blocking the rest, and this
 * function itself never throws.
 */
export async function evaluateApplicationWorkflows(
  context: SessionContext,
  applicationId: string,
  triggerType: WorkflowTriggerType,
  triggerMatches: (triggerConfig: Prisma.JsonValue) => boolean,
  fingerprint: string,
): Promise<void> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: applicationForWorkflowSelect,
  });
  if (!application) return;

  const definitions = await prisma.workflowDefinition.findMany({
    where: {
      isActive: true,
      OR: [{ jobId: null }, { jobId: application.jobId }],
      activeVersion: { triggerType },
    },
    include: { activeVersion: true },
  });

  for (const definition of definitions) {
    const version = definition.activeVersion as WorkflowVersionRow | null;
    if (!version || !triggerMatches(version.triggerConfig)) continue;

    const conditions = (version.conditions as unknown as WorkflowCondition[]) ?? [];
    const customFields = (application.customFields as Record<string, unknown>) ?? {};
    if (!evaluateConditions(conditions, customFields)) continue;

    const executionId = await claimExecutionSlot(version.id, applicationId, fingerprint);
    if (!executionId) continue;

    await runActionsAndFinalize(context, application, version, executionId);
  }
}

/**
 * TIME_IN_STAGE is not event-driven like the other three triggers — no
 * single write "causes" it, so it needs periodic evaluation. No cron/queue
 * infrastructure exists anywhere in this app (the same limitation Module
 * 9's scheduled reports already document) — this function is the real
 * logic; POST /api/workflows/run-due exists for an external scheduler to
 * call. Acts as the workflow's *creator*, resolved fresh via
 * getSessionContextForUser — there is no live triggering request to borrow
 * a session from, the same reasoning runDueScheduledReports uses. A
 * deactivated creator's workflows are skipped, not run as no one.
 */
export async function runDueTimeInStageWorkflows(now: Date = new Date()): Promise<{ evaluatedCount: number; firedCount: number }> {
  const definitions = await prisma.workflowDefinition.findMany({
    where: { isActive: true, activeVersion: { triggerType: "TIME_IN_STAGE" } },
    include: { activeVersion: true },
  });

  let evaluatedCount = 0;
  let firedCount = 0;

  for (const definition of definitions) {
    const version = definition.activeVersion as WorkflowVersionRow | null;
    if (!version) continue;

    const config = version.triggerConfig as unknown as { stageId: string; days: number };
    const cutoff = new Date(now.getTime() - config.days * DAY_MS);

    const creatorContext = await getSessionContextForUser(definition.createdById);
    if (!creatorContext) continue;

    const applications = await prisma.application.findMany({
      where: {
        stageId: config.stageId,
        stageEnteredAt: { lte: cutoff },
        outcome: "ACTIVE",
        ...(definition.jobId ? { jobId: definition.jobId } : {}),
      },
      select: applicationForWorkflowSelect,
      orderBy: { stageEnteredAt: "asc" },
      take: MAX_APPLICATIONS_PER_DEFINITION_PER_RUN,
    });

    for (const application of applications) {
      evaluatedCount += 1;

      const conditions = (version.conditions as unknown as WorkflowCondition[]) ?? [];
      const customFields = (application.customFields as Record<string, unknown>) ?? {};
      if (!evaluateConditions(conditions, customFields)) continue;

      const fingerprint = application.stageEnteredAt.toISOString();
      const executionId = await claimExecutionSlot(version.id, application.id, fingerprint);
      if (!executionId) continue;

      await runActionsAndFinalize(creatorContext, application, version, executionId);
      firedCount += 1;
    }
  }

  return { evaluatedCount, firedCount };
}
