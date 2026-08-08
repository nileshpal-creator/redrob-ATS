import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import {
  can,
  ForbiddenError,
  getEffectiveScope,
  getFieldAccess,
  getTeamMemberIds,
  requirePermission,
} from "@/lib/authz/authorize";
import { assertWritableFields, sanitizeForRead, sanitizeManyForRead } from "@/lib/authz/field-sanitizer";
import type { SessionContext } from "@/lib/authz/session-context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { buildCustomFieldValueSchema } from "@/lib/custom-fields/dynamic-schema";
import { findTransition, getLegalActions, type JobTransition } from "@/lib/jobs/status-machine";
import { seedDefaultPipelineStages } from "@/lib/services/pipeline-stages";
import {
  assertCanDecideStep,
  buildApprovalStepSnapshots,
  isChainComplete,
  selectCurrentPendingStep,
} from "@/lib/services/approvals";
import type { JobStatus } from "@/generated/prisma/enums";
import type {
  JobCreateInput,
  JobQuery,
  JobRecruitersUpdateInput,
  JobStatusActionInput,
  JobUpdateInput,
} from "@/lib/validations/job";

const userSummarySelect = { id: true, name: true, email: true } as const;

const jobListInclude = {
  department: true,
  location: true,
  primaryRecruiter: { select: userSummarySelect },
  recruiters: { include: { user: { select: userSummarySelect } } },
} satisfies Prisma.JobInclude;

const jobDetailInclude = {
  ...jobListInclude,
  createdBy: { select: userSummarySelect },
  parentJob: { select: { id: true, title: true } },
  childJobs: { select: { id: true, title: true, status: true } },
  statusChanges: {
    orderBy: { createdAt: "desc" },
    include: { actor: { select: userSummarySelect }, reason: true },
  },
  approvals: {
    orderBy: { stepOrder: "asc" },
    include: { approver: { select: userSummarySelect } },
  },
} satisfies Prisma.JobInclude;

type JobOwnership = { primaryRecruiterId: string };

async function assertControlledListValue(listKey: string, valueId: string, fieldLabel: string) {
  const value = await prisma.controlledListValue.findUnique({
    where: { id: valueId },
    include: { list: true },
  });
  if (!value || !value.isActive || value.list.key !== listKey) {
    throw new ValidationError(`Invalid ${fieldLabel}.`);
  }
}

async function assertActiveUsers(userIds: string[], fieldLabel: string) {
  const uniqueIds = Array.from(new Set(userIds));
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    select: { id: true },
  });
  if (users.length !== uniqueIds.length) {
    throw new ValidationError(`One or more ${fieldLabel} could not be found or are inactive.`);
  }
}

async function validateCustomFields(customFields: Record<string, unknown> | undefined) {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: ENTITY.JOB, isActive: true },
  });
  if (definitions.length === 0) {
    return {};
  }
  return buildCustomFieldValueSchema(definitions).parse(customFields ?? {});
}

/**
 * Ownership resolves against Job.primaryRecruiterId for every action,
 * including APPROVE/REJECT — the PRD's Job data model (§9) names only
 * "assigned recruiter(s)", not a separate approver field. Roles that
 * approve without being the assigned recruiter (Hiring Manager, Recruiting
 * Manager) are granted ALL/TEAM scope in prisma/seed.ts instead.
 */
async function assertJobAccess(context: SessionContext, job: JobOwnership, action: PermissionAction) {
  if (await can(context, ENTITY.JOB, action)) return;
  if (await can(context, ENTITY.JOB, action, { ownerId: job.primaryRecruiterId })) return;
  throw new ForbiddenError();
}

export async function listJobs(context: SessionContext, query: JobQuery) {
  const scope = await getEffectiveScope(context, ENTITY.JOB, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.JobWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { primaryRecruiterId: context.userId };
  } else if (scope === "TEAM") {
    const teamIds = await getTeamMemberIds(context.userId);
    ownerFilter = { primaryRecruiterId: { in: teamIds } };
  }

  const where: Prisma.JobWhereInput = {
    ...ownerFilter,
    status: query.status,
    departmentId: query.departmentId,
    locationId: query.locationId,
    priority: query.priority,
    ...(query.recruiterId ? { recruiters: { some: { userId: query.recruiterId } } } : {}),
    ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
  };

  const [jobs, total, fieldAccess] = await Promise.all([
    prisma.job.findMany({
      where,
      include: jobListInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.job.count({ where }),
    getFieldAccess(context, ENTITY.JOB),
  ]);

  return { jobs: sanitizeManyForRead(jobs, fieldAccess), total, page: query.page, pageSize: query.pageSize };
}

export async function getJobById(context: SessionContext, id: string) {
  const job = await prisma.job.findUnique({ where: { id }, include: jobDetailInclude });
  if (!job) {
    throw new NotFoundError("Job not found.");
  }
  await assertJobAccess(context, job, "READ");
  const fieldAccess = await getFieldAccess(context, ENTITY.JOB);
  return sanitizeForRead(job, fieldAccess);
}

/** Which status-change buttons a detail page should offer this viewer, right now. */
export async function getAvailableTransitions(
  context: SessionContext,
  job: JobOwnership & { status: JobStatus },
): Promise<JobTransition[]> {
  const candidates = getLegalActions(job.status);
  const allowed: JobTransition[] = [];

  for (const transition of candidates) {
    if (
      (await can(context, ENTITY.JOB, transition.requiredAction)) ||
      (await can(context, ENTITY.JOB, transition.requiredAction, { ownerId: job.primaryRecruiterId }))
    ) {
      allowed.push(transition);
    }
  }

  return allowed;
}

export async function createJob(context: SessionContext, input: JobCreateInput) {
  await requirePermission(context, ENTITY.JOB, "CREATE");

  await assertControlledListValue("DEPARTMENT", input.departmentId, "department");
  await assertControlledListValue("LOCATION", input.locationId, "location");
  await assertActiveUsers(input.recruiterUserIds, "recruiters");

  if (input.parentJobId) {
    const parent = await prisma.job.findUnique({ where: { id: input.parentJobId }, select: { id: true } });
    if (!parent) {
      throw new ValidationError("Parent requisition not found.");
    }
  }

  const customFields = await validateCustomFields(input.customFields);

  const fieldAccess = await getFieldAccess(context, ENTITY.JOB);
  assertWritableFields({ ...input, customFields }, fieldAccess);

  // Application.stageId is required and Module 4 gives every job a starter
  // pipeline at creation time, editable/reorderable afterward via
  // PUT /api/jobs/[id]/pipeline-stages — see seedDefaultPipelineStages.
  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        title: input.title,
        departmentId: input.departmentId,
        locationId: input.locationId,
        employmentType: input.employmentType,
        priority: input.priority,
        positionsCount: input.positionsCount,
        targetDate: input.targetDate,
        description: input.description,
        mustHaveCriteria: input.mustHaveCriteria,
        goodToHaveCriteria: input.goodToHaveCriteria,
        customFields: customFields as Prisma.InputJsonValue,
        parentJobId: input.parentJobId,
        primaryRecruiterId: input.primaryRecruiterUserId,
        createdById: context.userId,
        recruiters: {
          createMany: {
            data: input.recruiterUserIds.map((userId) => ({
              userId,
              isPrimary: userId === input.primaryRecruiterUserId,
            })),
          },
        },
      },
      include: jobDetailInclude,
    });

    await seedDefaultPipelineStages(tx, job.id);

    return job;
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_CREATED,
    entityType: ENTITY.JOB,
    entityId: created.id,
    changes: { after: { title: created.title, status: created.status } },
  });

  return sanitizeForRead(created, fieldAccess);
}

export async function updateJob(context: SessionContext, id: string, input: JobUpdateInput) {
  const existing = await prisma.job.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Job not found.");
  }
  await assertJobAccess(context, existing, "UPDATE");

  if (input.departmentId) await assertControlledListValue("DEPARTMENT", input.departmentId, "department");
  if (input.locationId) await assertControlledListValue("LOCATION", input.locationId, "location");
  if (input.parentJobId) {
    if (input.parentJobId === id) {
      throw new ValidationError("A job cannot be its own parent.");
    }
    const parent = await prisma.job.findUnique({ where: { id: input.parentJobId }, select: { id: true } });
    if (!parent) {
      throw new ValidationError("Parent requisition not found.");
    }
  }

  const customFields =
    input.customFields !== undefined ? await validateCustomFields(input.customFields) : undefined;

  const fieldAccess = await getFieldAccess(context, ENTITY.JOB);
  assertWritableFields({ ...input, ...(customFields !== undefined && { customFields }) }, fieldAccess);

  const data: Prisma.JobUpdateManyMutationInput = {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.departmentId !== undefined && { departmentId: input.departmentId }),
    ...(input.locationId !== undefined && { locationId: input.locationId }),
    ...(input.employmentType !== undefined && { employmentType: input.employmentType }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.positionsCount !== undefined && { positionsCount: input.positionsCount }),
    ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.mustHaveCriteria !== undefined && { mustHaveCriteria: input.mustHaveCriteria }),
    ...(input.goodToHaveCriteria !== undefined && { goodToHaveCriteria: input.goodToHaveCriteria }),
    ...(input.parentJobId !== undefined && { parentJobId: input.parentJobId }),
    ...(customFields !== undefined && { customFields: customFields as Prisma.InputJsonValue }),
    version: { increment: 1 },
  };

  const result = await prisma.job.updateMany({ where: { id, version: input.version }, data });
  if (result.count === 0) {
    throw new ConflictError("This job was changed by someone else. Reload and try again.");
  }

  const updated = await prisma.job.findUniqueOrThrow({ where: { id }, include: jobDetailInclude });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_UPDATED,
    entityType: ENTITY.JOB,
    entityId: id,
    changes: { before: existing, after: data },
  });

  return sanitizeForRead(updated, fieldAccess);
}

export async function updateJobRecruiters(
  context: SessionContext,
  id: string,
  input: JobRecruitersUpdateInput,
) {
  const existing = await prisma.job.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Job not found.");
  }
  await assertJobAccess(context, existing, "UPDATE");
  await assertActiveUsers(input.assignments.map((assignment) => assignment.userId), "recruiters");

  const primary = input.assignments.find((assignment) => assignment.isPrimary);
  if (!primary) {
    throw new ValidationError("Exactly one recruiter must be marked primary.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.job.updateMany({
      where: { id, version: input.version },
      data: { primaryRecruiterId: primary.userId, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError("This job was changed by someone else. Reload and try again.");
    }

    await tx.jobRecruiterAssignment.deleteMany({ where: { jobId: id } });
    await tx.jobRecruiterAssignment.createMany({
      data: input.assignments.map((assignment) => ({
        jobId: id,
        userId: assignment.userId,
        isPrimary: assignment.isPrimary,
      })),
    });

    return tx.job.findUniqueOrThrow({ where: { id }, include: jobDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_RECRUITERS_UPDATED,
    entityType: ENTITY.JOB,
    entityId: id,
    changes: { after: { assignments: input.assignments } },
  });

  const fieldAccess = await getFieldAccess(context, ENTITY.JOB);
  return sanitizeForRead(updated, fieldAccess);
}

export async function transitionJobStatus(
  context: SessionContext,
  id: string,
  input: JobStatusActionInput,
) {
  const existing = await prisma.job.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Job not found.");
  }

  const transition = findTransition(existing.status, input.action);
  if (!transition) {
    throw new ValidationError(`Cannot ${input.action} a job in ${existing.status} status.`);
  }

  await assertJobAccess(context, existing, transition.requiredAction);

  if (transition.reasonRequired) {
    if (!input.reasonId) {
      throw new ValidationError("A reason is required for this transition.");
    }
    await assertControlledListValue(transition.reasonListKey!, input.reasonId, "reason");
  }

  if (input.action === "APPROVE" || input.action === "REJECT") {
    return decideJobApprovalStep(context, id, existing, input, transition);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.job.updateMany({
      where: { id, version: input.version },
      data: { status: transition.to, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError("This job was changed by someone else. Reload and try again.");
    }

    await tx.jobStatusChange.create({
      data: {
        jobId: id,
        fromStatus: existing.status,
        toStatus: transition.to,
        reasonId: input.reasonId,
        note: input.note,
        actorId: context.userId,
      },
    });

    // §11.1: "Configurable approval steps." The chain is snapshotted onto
    // JobApproval at the moment a Job is actually submitted — see
    // buildApprovalStepSnapshots's own comment for why this must be a
    // snapshot, not a live reference to ApprovalStepConfig.
    if (input.action === "SUBMIT") {
      const steps = await buildApprovalStepSnapshots(tx, "JOB");
      await tx.jobApproval.createMany({ data: steps.map((step) => ({ jobId: id, ...step })) });
    }

    return tx.job.findUniqueOrThrow({ where: { id }, include: jobDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_STATUS_CHANGED,
    entityType: ENTITY.JOB,
    entityId: id,
    changes: { before: { status: existing.status }, after: { status: transition.to, action: input.action } },
  });

  const fieldAccess = await getFieldAccess(context, ENTITY.JOB);
  return sanitizeForRead(updated, fieldAccess);
}

/**
 * APPROVE/REJECT act on the single current step (lowest stepOrder among
 * PENDING rows), not directly on Job.status. REJECT always fails the whole
 * chain immediately (existing single-step semantics preserved) and marks
 * every other still-PENDING row SKIPPED. APPROVE only flips Job.status to
 * the transition table's `to` once no PENDING rows remain — an
 * intermediate approval (more steps still pending) records the decision
 * but leaves Job.status at PENDING_APPROVAL for the next approver.
 *
 * The JobApproval row's own PENDING-guarded `updateMany` is this
 * function's optimistic lock — a second decider racing for the same step
 * simply finds `result.count === 0` and gets a ConflictError, the same
 * shape `input.version` already guards the Job row itself with.
 */
async function decideJobApprovalStep(
  context: SessionContext,
  id: string,
  existing: { status: JobStatus },
  input: JobStatusActionInput,
  transition: JobTransition,
) {
  const steps = await prisma.jobApproval.findMany({ where: { jobId: id } });
  const currentStep = selectCurrentPendingStep(steps);
  if (!currentStep) {
    throw new ValidationError("No pending approval step found for this job.");
  }
  assertCanDecideStep(context, currentStep);

  const decision = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
  const chainWillComplete = input.action === "REJECT" || isChainComplete(steps, currentStep.id);

  const updated = await prisma.$transaction(async (tx) => {
    const decided = await tx.jobApproval.updateMany({
      where: { id: currentStep.id, status: "PENDING" },
      data: { status: decision, approverId: context.userId, comments: input.note, decidedAt: new Date() },
    });
    if (decided.count === 0) {
      throw new ConflictError("This approval step was already decided by someone else. Reload and try again.");
    }

    if (input.action === "REJECT") {
      await tx.jobApproval.updateMany({
        where: { jobId: id, status: "PENDING", id: { not: currentStep.id } },
        data: { status: "SKIPPED" },
      });
    }

    if (chainWillComplete) {
      const result = await tx.job.updateMany({
        where: { id, version: input.version },
        data: { status: transition.to, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictError("This job was changed by someone else. Reload and try again.");
      }
      await tx.jobStatusChange.create({
        data: {
          jobId: id,
          fromStatus: existing.status,
          toStatus: transition.to,
          note: input.note,
          actorId: context.userId,
        },
      });
    }

    return tx.job.findUniqueOrThrow({ where: { id }, include: jobDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.JOB_APPROVAL_STEP_DECIDED,
    entityType: ENTITY.JOB,
    entityId: id,
    changes: { after: { stepOrder: currentStep.stepOrder, decision, chainComplete: chainWillComplete } },
  });

  if (chainWillComplete) {
    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.JOB_STATUS_CHANGED,
      entityType: ENTITY.JOB,
      entityId: id,
      changes: { before: { status: existing.status }, after: { status: transition.to, action: input.action } },
    });
  }

  const fieldAccess = await getFieldAccess(context, ENTITY.JOB);
  return sanitizeForRead(updated, fieldAccess);
}
