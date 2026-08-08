import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { getActiveCommunicationTemplateOrThrow, listCommunicationTemplates } from "@/lib/services/communication-templates";
import { listCustomFieldDefinitions } from "@/lib/services/custom-fields";
import { listJobs } from "@/lib/services/jobs";
import { jobQuerySchema } from "@/lib/validations/job";
import { listActivePipelineStagesForJobs } from "@/lib/services/pipeline-stages";
import { listUsers } from "@/lib/services/users";
import type {
  WorkflowAction,
  WorkflowCondition,
  WorkflowDefinitionCreateInput,
  WorkflowDefinitionQuery,
  WorkflowDefinitionUpdateInput,
  WorkflowRollbackInput,
  WorkflowTrigger,
} from "@/lib/validations/workflow";

const userSummarySelect = { id: true, name: true, email: true } as const;

const workflowDefinitionInclude = {
  createdBy: { select: userSummarySelect },
  job: { select: { id: true, title: true } },
  activeVersion: true,
} satisfies Prisma.WorkflowDefinitionInclude;

const workflowDefinitionDetailInclude = {
  ...workflowDefinitionInclude,
  versions: {
    orderBy: { versionNumber: "desc" },
    include: { createdBy: { select: userSummarySelect } },
  },
} satisfies Prisma.WorkflowDefinitionInclude;

type WorkflowDefinitionOwnership = { createdById: string };

async function assertWorkflowDefinitionAccess(
  context: SessionContext,
  definition: WorkflowDefinitionOwnership,
  action: "READ" | "UPDATE",
) {
  if (await can(context, ENTITY.WORKFLOW_DEFINITION, action)) return;
  if (await can(context, ENTITY.WORKFLOW_DEFINITION, action, { ownerId: definition.createdById })) return;
  throw new ForbiddenError();
}

async function assertActiveUser(userId: string, fieldLabel: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user || !user.isActive) {
    throw new ValidationError(`${fieldLabel} must be an active user.`);
  }
}

/**
 * STAGE_CHANGE and TIME_IN_STAGE both reference a specific PipelineStage id
 * — and stages are job-scoped (each job has its own PipelineStage rows,
 * even for identically-named stages) — so a workflow using either trigger
 * cannot be "global" (jobId null); it must be scoped to the one job whose
 * stage it names. FIELD_UPDATE/FORM_SUBMISSION reference no stage and may
 * be global or per-job freely.
 */
async function assertTriggerValid(jobId: string | null, trigger: WorkflowTrigger) {
  if (trigger.type === "STAGE_CHANGE" || trigger.type === "TIME_IN_STAGE") {
    if (!jobId) {
      throw new ValidationError(`A ${trigger.type} trigger requires a specific job — pipeline stages are job-scoped.`);
    }
    const stageId = trigger.type === "STAGE_CHANGE" ? trigger.config.toStageId : trigger.config.stageId;
    const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.jobId !== jobId || !stage.isActive) {
      throw new ValidationError("The selected stage must be an active stage belonging to the chosen job.");
    }
    return;
  }

  if (trigger.type === "FIELD_UPDATE") {
    const definition = await prisma.customFieldDefinition.findFirst({
      where: { entityType: ENTITY.APPLICATION, key: trigger.config.fieldKey, isActive: true },
    });
    if (!definition) {
      throw new ValidationError(`Unknown or inactive custom field "${trigger.config.fieldKey}".`);
    }
  }
}

async function assertConditionsValid(conditions: WorkflowCondition[]) {
  if (conditions.length === 0) return;
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: ENTITY.APPLICATION, isActive: true },
    select: { key: true },
  });
  const activeKeys = new Set(definitions.map((definition) => definition.key));
  for (const condition of conditions) {
    if (!activeKeys.has(condition.field)) {
      throw new ValidationError(`Unknown or inactive custom field "${condition.field}" in conditions.`);
    }
  }
}

async function assertActionsValid(actions: WorkflowAction[]) {
  for (const action of actions) {
    switch (action.type) {
      case "SEND_EMAIL":
        await getActiveCommunicationTemplateOrThrow(action.templateId);
        break;
      case "CREATE_TASK":
        await assertActiveUser(action.assignedToId, "Task assignee");
        break;
      case "CHANGE_FIELD": {
        const definition = await prisma.customFieldDefinition.findFirst({
          where: { entityType: ENTITY.APPLICATION, key: action.fieldKey, isActive: true },
        });
        if (!definition) {
          throw new ValidationError(`Unknown or inactive custom field "${action.fieldKey}".`);
        }
        break;
      }
      case "REASSIGN_OWNER":
        await assertActiveUser(action.userId, "New owner");
        break;
      case "REQUEST_APPROVAL":
        await assertActiveUser(action.approverId, "Approver");
        break;
    }
  }
}

export async function listWorkflowDefinitions(context: SessionContext, query: WorkflowDefinitionQuery) {
  const scope = await getEffectiveScope(context, ENTITY.WORKFLOW_DEFINITION, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.WorkflowDefinitionWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { createdById: context.userId };
  } else if (scope === "TEAM") {
    ownerFilter = { createdById: { in: await getTeamMemberIds(context.userId) } };
  }

  return prisma.workflowDefinition.findMany({
    where: { ...ownerFilter, jobId: query.jobId, isActive: query.isActive },
    include: workflowDefinitionInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getWorkflowDefinition(context: SessionContext, id: string) {
  const definition = await prisma.workflowDefinition.findUnique({ where: { id }, include: workflowDefinitionDetailInclude });
  if (!definition) {
    throw new NotFoundError("Workflow not found.");
  }
  await assertWorkflowDefinitionAccess(context, definition, "READ");
  return definition;
}

export async function createWorkflowDefinition(context: SessionContext, input: WorkflowDefinitionCreateInput) {
  await requirePermission(context, ENTITY.WORKFLOW_DEFINITION, "CREATE");

  const jobId = input.jobId ?? null;
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) {
      throw new ValidationError("Job not found.");
    }
  }
  await assertTriggerValid(jobId, input.trigger);
  await assertConditionsValid(input.conditions);
  await assertActionsValid(input.actions);

  const created = await prisma.$transaction(async (tx) => {
    const definition = await tx.workflowDefinition.create({
      data: { name: input.name, jobId, isActive: input.isActive, createdById: context.userId },
    });
    const version = await tx.workflowDefinitionVersion.create({
      data: {
        workflowDefinitionId: definition.id,
        versionNumber: 1,
        triggerType: input.trigger.type,
        triggerConfig: input.trigger.config as Prisma.InputJsonValue,
        conditions: input.conditions as Prisma.InputJsonValue,
        actions: input.actions as Prisma.InputJsonValue,
        createdById: context.userId,
      },
    });
    return tx.workflowDefinition.update({
      where: { id: definition.id },
      data: { activeVersionId: version.id },
      include: workflowDefinitionDetailInclude,
    });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.WORKFLOW_DEFINITION_CREATED,
    entityType: ENTITY.WORKFLOW_DEFINITION,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

/**
 * `trigger`/`conditions`/`actions` are all-or-nothing (enforced in Zod) —
 * supplying them creates a new WorkflowDefinitionVersion row and re-points
 * `activeVersionId`, never mutating an existing version. `jobId` is
 * deliberately not editable here — re-scoping a live workflow to a
 * different job mid-life is a bigger design question (existing
 * WorkflowExecution/WorkflowTask history would still point at the old
 * job's applications) than this pass needs to answer; create a new
 * workflow instead.
 */
export async function updateWorkflowDefinition(
  context: SessionContext,
  id: string,
  input: WorkflowDefinitionUpdateInput,
) {
  const existing = await prisma.workflowDefinition.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Workflow not found.");
  }
  await assertWorkflowDefinitionAccess(context, existing, "UPDATE");

  const isConfigChange = input.trigger !== undefined;
  if (isConfigChange && input.trigger) {
    await assertTriggerValid(existing.jobId, input.trigger);
    await assertConditionsValid(input.conditions ?? []);
    await assertActionsValid(input.actions ?? []);
  }

  const updated = await prisma.$transaction(async (tx) => {
    let activeVersionId: string | undefined;

    if (isConfigChange && input.trigger) {
      const maxVersion = await tx.workflowDefinitionVersion.aggregate({
        where: { workflowDefinitionId: id },
        _max: { versionNumber: true },
      });
      const newVersion = await tx.workflowDefinitionVersion.create({
        data: {
          workflowDefinitionId: id,
          versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
          triggerType: input.trigger.type,
          triggerConfig: input.trigger.config as Prisma.InputJsonValue,
          conditions: (input.conditions ?? []) as Prisma.InputJsonValue,
          actions: (input.actions ?? []) as Prisma.InputJsonValue,
          createdById: context.userId,
        },
      });
      activeVersionId = newVersion.id;
    }

    const data: Prisma.WorkflowDefinitionUpdateManyMutationInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(activeVersionId !== undefined && { activeVersionId }),
      version: { increment: 1 },
    };

    const result = await tx.workflowDefinition.updateMany({ where: { id, version: input.version }, data });
    if (result.count === 0) {
      throw new ConflictError("This workflow was changed by someone else. Reload and try again.");
    }

    return tx.workflowDefinition.findUniqueOrThrow({ where: { id }, include: workflowDefinitionDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.WORKFLOW_DEFINITION_UPDATED,
    entityType: ENTITY.WORKFLOW_DEFINITION,
    entityId: id,
    changes: { before: existing, after: updated },
  });

  return updated;
}

/**
 * Re-points `activeVersionId` at an older, already-existing version — it
 * never mutates or deletes history, so §10.2's "full version history... with
 * the ability to roll back" holds exactly: every version ever saved stays
 * queryable via `versions` regardless of which one is currently active.
 */
export async function rollbackWorkflowDefinition(context: SessionContext, id: string, input: WorkflowRollbackInput) {
  const existing = await prisma.workflowDefinition.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Workflow not found.");
  }
  await assertWorkflowDefinitionAccess(context, existing, "UPDATE");

  const target = await prisma.workflowDefinitionVersion.findUnique({ where: { id: input.targetVersionId } });
  if (!target || target.workflowDefinitionId !== id) {
    throw new ValidationError("The selected version does not belong to this workflow.");
  }

  const result = await prisma.workflowDefinition.updateMany({
    where: { id, version: input.version },
    data: { activeVersionId: target.id, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new ConflictError("This workflow was changed by someone else. Reload and try again.");
  }

  const updated = await prisma.workflowDefinition.findUniqueOrThrow({ where: { id }, include: workflowDefinitionDetailInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.WORKFLOW_DEFINITION_ROLLED_BACK,
    entityType: ENTITY.WORKFLOW_DEFINITION,
    entityId: id,
    changes: { after: { targetVersionId: target.id, targetVersionNumber: target.versionNumber } },
  });

  return updated;
}

/**
 * Picker data for the /admin/workflows builder form (jobs+stages for
 * STAGE_CHANGE/TIME_IN_STAGE, active users for CREATE_TASK/REQUEST_APPROVAL/
 * REASSIGN_OWNER, active email templates for SEND_EMAIL, active
 * Application custom fields for conditions/CHANGE_FIELD/FIELD_UPDATE) — one
 * bulk stage fetch across every visible job, not a per-job round trip, to
 * avoid an N+1. `listUsers` requires USER:READ, which isn't guaranteed for
 * every role that can reach this form, so it degrades to an empty list
 * instead of failing the whole page (same pattern the /reports page uses).
 */
export async function getWorkflowFormReferenceData(context: SessionContext) {
  const [jobsResult, templates, customFields, users] = await Promise.all([
    listJobs(context, jobQuerySchema.parse({ pageSize: 100 })).catch((error) => {
      if (error instanceof ForbiddenError) return { jobs: [] as { id: string; title: string }[] };
      throw error;
    }),
    listCommunicationTemplates(context, { isActive: true }),
    listCustomFieldDefinitions(context, ENTITY.APPLICATION),
    listUsers(context).catch((error) => {
      if (error instanceof ForbiddenError) return [];
      throw error;
    }),
  ]);

  const jobs = jobsResult.jobs.map((job) => ({ id: job.id, title: job.title }));
  const stages = await listActivePipelineStagesForJobs(jobs.map((job) => job.id));

  return {
    jobs,
    stages: stages.map((stage) => ({ id: stage.id, jobId: stage.jobId, name: stage.name })),
    templates: templates.map((template) => ({ id: template.id, name: template.name })),
    customFields: customFields.map((field) => ({ key: field.key, label: field.label })),
    users: users.filter((user) => user.isActive).map((user) => ({ id: user.id, name: user.name })),
  };
}
export type WorkflowFormReferenceData = Awaited<ReturnType<typeof getWorkflowFormReferenceData>>;
