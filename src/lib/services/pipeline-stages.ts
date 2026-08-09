import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { PipelineStagesReplaceInput } from "@/lib/validations/application";

/**
 * A new Job has no PipelineStage rows yet, and Application.stageId is
 * required, so every job needs at least one stage before it can accept an
 * application. This default set is inserted by createJob at creation time
 * (src/lib/services/jobs.ts) and by prisma/backfill-pipeline-stages.ts for
 * jobs that predate this module.
 */
export const DEFAULT_PIPELINE_STAGE_NAMES = ["Applied", "Screening", "Interview", "Offer"] as const;

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export async function seedDefaultPipelineStages(client: PrismaClientOrTx, jobId: string) {
  await client.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGE_NAMES.map((name, index) => ({ jobId, name, sortOrder: index })),
  });
}

type JobOwnership = { primaryRecruiterId: string };

/**
 * Pipeline configuration is authorized as JOB:<action> on the parent job
 * (Phase 2 decision), not a separate resource — configuring a job's
 * pipeline is conceptually part of configuring that job, the same way
 * recruiter assignment already is. Deliberately not imported from
 * src/lib/services/jobs.ts to avoid a circular import (jobs.ts calls
 * seedDefaultPipelineStages from this file) — same small, per-service
 * ownership-assertion pattern as assertJobAccess/assertCandidateAccess.
 */
async function assertJobAccess(context: SessionContext, job: JobOwnership, action: PermissionAction) {
  if (await can(context, ENTITY.JOB, action)) return;
  if (await can(context, ENTITY.JOB, action, { ownerId: job.primaryRecruiterId })) return;
  throw new ForbiddenError();
}

async function getJobForStageAccess(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, primaryRecruiterId: true },
  });
  if (!job) {
    throw new NotFoundError("Job not found.");
  }
  return job;
}

export async function getPipelineStages(context: SessionContext, jobId: string) {
  const job = await getJobForStageAccess(jobId);
  await assertJobAccess(context, job, "READ");

  return prisma.pipelineStage.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" } });
}

/**
 * Bulk picker data for the Module 10 workflow builder — STAGE_CHANGE/
 * TIME_IN_STAGE triggers reference one PipelineStage id, and the builder
 * needs every active stage across every job the caller can already see to
 * populate that picker. A single findMany across all of `jobIds`, not one
 * getPipelineStages call per job, to avoid an N+1. Stage names/ids aren't
 * sensitive beyond the job list the caller already has access to (same
 * "structural, not sensitive" reasoning listCustomFieldDefinitions uses),
 * so no extra per-job RBAC check here.
 */
export async function listActivePipelineStagesForJobs(jobIds: string[]) {
  if (jobIds.length === 0) return [];
  return prisma.pipelineStage.findMany({
    where: { jobId: { in: jobIds }, isActive: true },
    orderBy: [{ jobId: "asc" }, { sortOrder: "asc" }],
  });
}

/**
 * Full-set replace, same convention as updateJobRecruiters: the client
 * always PUTs the complete desired pipeline. Entries whose `id` matches an
 * existing stage are renamed/reordered/reactivated in place; entries with no
 * `id` are created; existing stages omitted from the array are deactivated,
 * never deleted — a stage may already be referenced by an Application or
 * ApplicationEvent, and PipelineStage rows are never hard-deleted.
 */
export async function replacePipelineStages(
  context: SessionContext,
  jobId: string,
  input: PipelineStagesReplaceInput,
) {
  const job = await getJobForStageAccess(jobId);
  await assertJobAccess(context, job, "UPDATE");

  const existing = await prisma.pipelineStage.findMany({ where: { jobId } });
  const existingById = new Map(existing.map((stage) => [stage.id, stage]));

  const keptIds = new Set(
    input.stages.filter((stage) => stage.id && existingById.has(stage.id)).map((stage) => stage.id as string),
  );
  const toDeactivate = existing.filter((stage) => !keptIds.has(stage.id) && stage.isActive);
  const toRename = input.stages.filter(
    (stage): stage is { id: string; name: string } => Boolean(stage.id) && existingById.has(stage.id!),
  );

  await prisma.$transaction(async (tx) => {
    // Deactivating a stage that still has ACTIVE applications sitting in it
    // used to be blocked only client-side (the pipeline-stage editor's own
    // activeApplicationCountByStageId check) — an API caller could bypass
    // that courtesy entirely. Checked inside the same transaction that does
    // the deactivating, so a concurrent application create/stage-move can't
    // race between this check and the write below.
    for (const stage of toDeactivate) {
      const activeCount = await tx.application.count({ where: { stageId: stage.id, outcome: "ACTIVE" } });
      if (activeCount > 0) {
        throw new ValidationError(
          `${activeCount} active application${activeCount === 1 ? "" : "s"} ${activeCount === 1 ? "is" : "are"} still in "${stage.name}". Move them to another stage first.`,
        );
      }
    }

    // The (jobId, name) partial unique index only exempts inactive rows, so
    // two kinds of transient collision are possible while this update runs
    // and must both be cleared before anything gets its real target name:
    // (1) swapping two kept stages' names, and (2) reusing a name that
    // currently belongs to a stage about to be deactivated. Every kept
    // stage is first moved to a name derived from its own id (which can
    // never collide with anything), then every stage being removed is
    // deactivated (exempting its old name from the index), and only then
    // do the real target names/creates get applied.
    for (const stage of toRename) {
      await tx.pipelineStage.update({ where: { id: stage.id }, data: { name: `__pending__${stage.id}` } });
    }

    for (const stage of toDeactivate) {
      await tx.pipelineStage.update({ where: { id: stage.id }, data: { isActive: false } });
    }

    for (const [index, stage] of input.stages.entries()) {
      if (stage.id && existingById.has(stage.id)) {
        await tx.pipelineStage.update({
          where: { id: stage.id },
          data: { name: stage.name, sortOrder: index, isActive: true },
        });
      } else {
        await tx.pipelineStage.create({ data: { jobId, name: stage.name, sortOrder: index } });
      }
    }
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.PIPELINE_STAGES_UPDATED,
    entityType: ENTITY.JOB,
    entityId: jobId,
    changes: { after: { stages: input.stages.map((stage) => stage.name) } },
  });

  return prisma.pipelineStage.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" } });
}
