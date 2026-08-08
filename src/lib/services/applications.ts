import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { ApplicationEventType, PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { buildCustomFieldValueSchema } from "@/lib/custom-fields/dynamic-schema";
import { renderTemplate } from "@/lib/templates/render";
import { assertApplicationNotHandedOff } from "@/lib/services/handoffs";
import { getActiveCommunicationTemplateOrThrow } from "@/lib/services/communication-templates";
import { getMailProvider } from "@/lib/mail";
import { evaluateApplicationWorkflows } from "@/lib/services/workflows";
import type {
  ApplicationBulkEmailInput,
  ApplicationBulkTransitionInput,
  ApplicationCreateInput,
  ApplicationDuplicateCheckInput,
  ApplicationQuery,
  ApplicationTransitionInput,
  ApplicationUpdateInput,
} from "@/lib/validations/application";

const userSummarySelect = { id: true, name: true, email: true } as const;

const applicationListInclude = {
  candidate: { select: { id: true, name: true, phone: true, email: true } },
  job: { select: { id: true, title: true } },
  stage: true,
  owner: { select: userSummarySelect },
} satisfies Prisma.ApplicationInclude;

const applicationDetailInclude = {
  ...applicationListInclude,
  createdBy: { select: userSummarySelect },
  outcomeReason: true,
  events: {
    orderBy: { createdAt: "desc" },
    include: {
      actor: { select: userSummarySelect },
      fromStage: true,
      toStage: true,
      reason: true,
    },
  },
} satisfies Prisma.ApplicationInclude;

type ApplicationOwnership = { ownerId: string };

async function assertControlledListValue(listKey: string, valueId: string, fieldLabel: string) {
  const value = await prisma.controlledListValue.findUnique({
    where: { id: valueId },
    include: { list: true },
  });
  if (!value || !value.isActive || value.list.key !== listKey) {
    throw new ValidationError(`Invalid ${fieldLabel}.`);
  }
}

async function assertActiveStage(stageId: string, jobId: string) {
  const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!stage || !stage.isActive || stage.jobId !== jobId) {
    throw new ValidationError("Invalid pipeline stage.");
  }
  return stage;
}

async function assertActiveUser(userId: string, fieldLabel: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user || !user.isActive) {
    throw new ValidationError(`${fieldLabel} must be an active user.`);
  }
}

/**
 * Module 10 (§10.2): fires configured automations after the triggering
 * write has already committed (see evaluateApplicationWorkflows's own doc
 * comment for why it runs outside that write's transaction). Awaited so it
 * completes before the response is sent, but its own errors are caught
 * here and only logged — a misbehaving automation must never fail or roll
 * back the user's own action that triggered it.
 */
async function fireWorkflowsInBackground(...args: Parameters<typeof evaluateApplicationWorkflows>) {
  await evaluateApplicationWorkflows(...args).catch((error: unknown) => {
    console.error("Workflow evaluation failed:", error);
  });
}

async function validateApplicationCustomFields(customFields: Record<string, unknown> | undefined) {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: ENTITY.APPLICATION, isActive: true },
  });
  if (definitions.length === 0) {
    return {};
  }
  return buildCustomFieldValueSchema(definitions).parse(customFields ?? {});
}

/**
 * §9 names `owner` as its own Application field, distinct from the
 * candidate/job themselves (unlike Candidate, which has no owner-like
 * field) — Phase 2 decision: a dedicated ownerId anchor, mirroring Job's
 * primaryRecruiterId pattern.
 */
async function assertApplicationAccess(
  context: SessionContext,
  application: ApplicationOwnership,
  action: PermissionAction,
) {
  if (await can(context, ENTITY.APPLICATION, action)) return;
  if (await can(context, ENTITY.APPLICATION, action, { ownerId: application.ownerId })) return;
  throw new ForbiddenError();
}

async function buildScopedWhere(
  context: SessionContext,
  query: Pick<ApplicationQuery, "jobId" | "candidateId" | "stageId" | "outcome" | "ownerId" | "q">,
): Promise<Prisma.ApplicationWhereInput> {
  const scope = await getEffectiveScope(context, ENTITY.APPLICATION, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.ApplicationWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { ownerId: context.userId };
  } else if (scope === "TEAM") {
    const teamIds = await getTeamMemberIds(context.userId);
    ownerFilter = { ownerId: { in: teamIds } };
  }

  return {
    jobId: query.jobId,
    candidateId: query.candidateId,
    stageId: query.stageId,
    outcome: query.outcome,
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.q ? { candidate: { name: { contains: query.q, mode: "insensitive" } } } : {}),
    // Spread last: an OWN/TEAM grant's scope must always win over a caller-
    // supplied ownerId filter, never be widened by one. Only ALL scope (an
    // empty ownerFilter) leaves the explicit ownerId filter above in effect.
    ...ownerFilter,
  };
}

export async function listApplications(context: SessionContext, query: ApplicationQuery) {
  const where = await buildScopedWhere(context, query);

  const [applications, total] = await Promise.all([
    prisma.application.findMany({
      where,
      include: applicationListInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.application.count({ where }),
  ]);

  return { applications, total, page: query.page, pageSize: query.pageSize };
}

export async function getApplication(context: SessionContext, id: string) {
  const application = await prisma.application.findUnique({ where: { id }, include: applicationDetailInclude });
  if (!application) {
    throw new NotFoundError("Application not found.");
  }
  await assertApplicationAccess(context, application, "READ");
  return application;
}

/**
 * Non-blocking pre-flight for the create form/import flow (§11.4: "warn
 * when re-adding a candidate previously in the pipeline for the same job" —
 * never block). Uses getEffectiveScope, not requirePermission, for the same
 * reason checkCandidateDuplicates does: this isn't checked against any one
 * record's ownership.
 */
export async function findDuplicateApplications(context: SessionContext, input: ApplicationDuplicateCheckInput) {
  const scope = await getEffectiveScope(context, ENTITY.APPLICATION, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  const priorApplications = await prisma.application.findMany({
    where: { candidateId: input.candidateId, jobId: input.jobId },
    select: { id: true, outcome: true, stageId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return { priorApplications };
}

export async function createApplication(context: SessionContext, input: ApplicationCreateInput) {
  await requirePermission(context, ENTITY.APPLICATION, "CREATE");

  const [candidate, job] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: input.candidateId }, select: { id: true } }),
    prisma.job.findUnique({ where: { id: input.jobId }, select: { id: true, primaryRecruiterId: true } }),
  ]);
  if (!candidate) {
    throw new ValidationError("Candidate not found.");
  }
  if (!job) {
    throw new ValidationError("Job not found.");
  }

  let stageId = input.stageId;
  if (stageId) {
    await assertActiveStage(stageId, input.jobId);
  } else {
    const firstStage = await prisma.pipelineStage.findFirst({
      where: { jobId: input.jobId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    if (!firstStage) {
      throw new ValidationError("This job has no active pipeline stages configured.");
    }
    stageId = firstStage.id;
  }

  // Owner defaults to the job's primary recruiter (Phase 2 decision) but
  // remains independently reassignable, at creation or later via updateApplication.
  const ownerId = input.ownerId ?? job.primaryRecruiterId;
  if (input.ownerId) {
    await assertActiveUser(input.ownerId, "Owner");
  }

  const customFields = await validateApplicationCustomFields(input.customFields);

  // Warn, never block (§11.4) — captured on the response, not thrown.
  const priorApplications = await prisma.application.findMany({
    where: { candidateId: input.candidateId, jobId: input.jobId },
    select: { id: true, outcome: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const created = await prisma.application.create({
    data: {
      candidateId: input.candidateId,
      jobId: input.jobId,
      stageId,
      ownerId,
      customFields: customFields as Prisma.InputJsonValue,
      createdById: context.userId,
    },
    include: applicationDetailInclude,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.APPLICATION_CREATED,
    entityType: ENTITY.APPLICATION,
    entityId: created.id,
    changes: { after: { candidateId: created.candidateId, jobId: created.jobId, stageId } },
  });

  // FORM_SUBMISSION has no trigger-config to match beyond the job-scoping
  // evaluateApplicationWorkflows already applies; the new application's own
  // id is a one-time fingerprint (this application is only ever created once).
  await fireWorkflowsInBackground(context, created.id, "FORM_SUBMISSION", () => true, created.id);

  return { ...created, priorApplications };
}

export async function updateApplication(context: SessionContext, id: string, input: ApplicationUpdateInput) {
  const existing = await prisma.application.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Application not found.");
  }
  await assertApplicationAccess(context, existing, "UPDATE");

  if (input.ownerId) {
    await assertActiveUser(input.ownerId, "Owner");
  }

  const customFields =
    input.customFields !== undefined ? await validateApplicationCustomFields(input.customFields) : undefined;

  const data: Prisma.ApplicationUpdateManyMutationInput = {
    ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
    ...(customFields !== undefined && { customFields: customFields as Prisma.InputJsonValue }),
    version: { increment: 1 },
  };

  const result = await prisma.application.updateMany({ where: { id, version: input.version }, data });
  if (result.count === 0) {
    throw new ConflictError("This application was changed by someone else. Reload and try again.");
  }

  const updated = await prisma.application.findUniqueOrThrow({ where: { id }, include: applicationDetailInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.APPLICATION_UPDATED,
    entityType: ENTITY.APPLICATION,
    entityId: id,
    changes: { before: existing, after: data },
  });

  // FIELD_UPDATE workflows key off *which* customFields keys actually
  // changed, not merely that the request touched customFields at all — a
  // no-op write (same value re-saved) must not re-fire the automation.
  if (customFields !== undefined) {
    const before = (existing.customFields as Record<string, unknown>) ?? {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(customFields)]);
    const changedKeys = new Set(
      [...allKeys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(customFields[key])),
    );
    if (changedKeys.size > 0) {
      await fireWorkflowsInBackground(
        context,
        id,
        "FIELD_UPDATE",
        (triggerConfig) => changedKeys.has((triggerConfig as { fieldKey?: string } | null)?.fieldKey ?? ""),
        updated.updatedAt.toISOString(),
      );
    }
  }

  return updated;
}

/**
 * The one entry point for STAGE_MOVE/REJECT/WITHDRAW — mirrors Job's
 * `/status` action-endpoint pattern rather than three separate routes.
 * Rejected/Withdrawn are terminal (Phase 2 decision): once outcome leaves
 * ACTIVE, no further transition — of any kind — is accepted.
 */
export async function transitionApplication(
  context: SessionContext,
  id: string,
  input: ApplicationTransitionInput,
) {
  const existing = await prisma.application.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Application not found.");
  }
  await assertApplicationAccess(context, existing, "UPDATE");

  if (existing.outcome !== "ACTIVE") {
    throw new ValidationError(
      `This application is already ${existing.outcome.toLowerCase()} and cannot be transitioned further.`,
    );
  }
  await assertApplicationNotHandedOff(id);

  let data: Prisma.ApplicationUncheckedUpdateManyInput;
  let eventType: ApplicationEventType;
  let toStageId: string | null = null;
  let reasonId: string | null = null;

  if (input.action === "STAGE_MOVE") {
    await assertActiveStage(input.toStageId, existing.jobId);
    toStageId = input.toStageId;
    data = { stageId: input.toStageId, stageEnteredAt: new Date(), version: { increment: 1 } };
    eventType = "STAGE_CHANGE";
  } else {
    await assertControlledListValue("REJECTION_REASON", input.reasonId, "reason");
    reasonId = input.reasonId;
    const outcome = input.action === "REJECT" ? "REJECTED" : "WITHDRAWN";
    data = { outcome, outcomeReasonId: input.reasonId, outcomeAt: new Date(), version: { increment: 1 } };
    eventType = outcome;
  }

  const { updated, eventId } = await prisma.$transaction(async (tx) => {
    const result = await tx.application.updateMany({ where: { id, version: input.version }, data });
    if (result.count === 0) {
      throw new ConflictError("This application was changed by someone else. Reload and try again.");
    }

    const event = await tx.applicationEvent.create({
      data: {
        applicationId: id,
        type: eventType,
        fromStageId: existing.stageId,
        toStageId,
        reasonId,
        note: input.note,
        actorId: context.userId,
      },
    });

    const application = await tx.application.findUniqueOrThrow({ where: { id }, include: applicationDetailInclude });
    return { updated: application, eventId: event.id };
  });

  await recordAudit({
    actorId: context.userId,
    action:
      input.action === "STAGE_MOVE"
        ? AUDIT_ACTIONS.APPLICATION_STAGE_CHANGED
        : input.action === "REJECT"
          ? AUDIT_ACTIONS.APPLICATION_REJECTED
          : AUDIT_ACTIONS.APPLICATION_WITHDRAWN,
    entityType: ENTITY.APPLICATION,
    entityId: id,
    changes: { before: { stageId: existing.stageId, outcome: existing.outcome }, after: data },
  });

  // STAGE_CHANGE workflows are keyed to one specific destination stage
  // (config.toStageId) — REJECT/WITHDRAW don't move a stage, so they never
  // trigger this. The ApplicationEvent this transition just created is a
  // one-time fingerprint (each transition creates exactly one new event).
  if (input.action === "STAGE_MOVE") {
    await fireWorkflowsInBackground(
      context,
      id,
      "STAGE_CHANGE",
      (triggerConfig) => (triggerConfig as { toStageId?: string } | null)?.toStageId === toStageId,
      eventId,
    );
  }

  return updated;
}

type BulkResult<T> = { succeeded: T[]; failed: { id: string; reason: string }[] };

/**
 * Best-effort, not atomic — one target's stale version or missing
 * permission doesn't fail the rest of the batch, matching
 * commitCandidateImport's created/skipped split. Each target still goes
 * through transitionApplication's own `$transaction`, so every individual
 * mutation + its ApplicationEvent row commit or roll back together.
 */
export async function bulkTransitionApplications(context: SessionContext, input: ApplicationBulkTransitionInput) {
  const succeeded: Awaited<ReturnType<typeof transitionApplication>>[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const target of input.applications) {
    try {
      const transitionInput: ApplicationTransitionInput =
        input.action === "STAGE_MOVE"
          ? { action: "STAGE_MOVE", version: target.version, toStageId: input.toStageId, note: input.note }
          : { action: input.action, version: target.version, reasonId: input.reasonId, note: input.note };

      succeeded.push(await transitionApplication(context, target.id, transitionInput));
    } catch (error) {
      failed.push({ id: target.id, reason: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.APPLICATION_BULK_TRANSITIONED,
    entityType: ENTITY.APPLICATION,
    entityId: "bulk",
    changes: { after: { action: input.action, succeeded: succeeded.length, failed: failed.length } },
  });

  return { succeeded, failed } satisfies BulkResult<Awaited<ReturnType<typeof transitionApplication>>>;
}

/**
 * §11.10 (Communication Hub): template-driven, actually delivered. The
 * template is resolved once, upfront — it's a shared precondition for the
 * whole call, not a per-application concern, so an invalid/inactive
 * templateId fails the entire request rather than showing up as N identical
 * per-item failures. Each recipient still gets its own try/catch: a bad
 * candidate email on one application must not block the rest of the batch,
 * same convention as bulkTransitionApplications.
 */
export async function bulkEmailApplications(context: SessionContext, input: ApplicationBulkEmailInput) {
  const template = await getActiveCommunicationTemplateOrThrow(input.templateId);
  const provider = getMailProvider();

  const succeeded: { applicationId: string; toEmail: string; status: "SENT" | "FAILED" }[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const applicationId of input.applicationIds) {
    try {
      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
          candidate: { select: { name: true, email: true } },
          job: { select: { title: true } },
        },
      });
      if (!application) {
        throw new NotFoundError("Application not found.");
      }
      await assertApplicationAccess(context, application, "UPDATE");

      if (!application.candidate.email) {
        throw new ValidationError("Candidate has no email on file.");
      }

      const renderContext = {
        "candidate.name": application.candidate.name,
        "job.title": application.job.title,
      };
      const subject = renderTemplate(template.subject, renderContext);
      const body = renderTemplate(template.body, renderContext);

      const result = await provider.send({ to: application.candidate.email, subject, body });

      const log = await prisma.applicationEmailLog.create({
        data: {
          applicationId,
          templateId: template.id,
          toEmail: application.candidate.email,
          subject,
          body,
          status: result.success ? "SENT" : "FAILED",
          requestedById: context.userId,
          sentAt: result.success ? new Date() : null,
        },
      });

      succeeded.push({ applicationId, toEmail: log.toEmail, status: log.status as "SENT" | "FAILED" });
    } catch (error) {
      failed.push({ id: applicationId, reason: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.APPLICATION_BULK_EMAIL_REQUESTED,
    entityType: ENTITY.APPLICATION,
    entityId: "bulk",
    changes: {
      after: {
        templateId: template.id,
        sent: succeeded.filter((item) => item.status === "SENT").length,
        failed: succeeded.filter((item) => item.status === "FAILED").length + failed.length,
      },
    },
  });

  return { succeeded, failed } satisfies BulkResult<{ applicationId: string; toEmail: string; status: "SENT" | "FAILED" }>;
}
