import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { ApprovalEntityType } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";
import { ForbiddenError, getEffectiveScope } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { ApprovalStepConfigsReplaceInput } from "@/lib/validations/approval";

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

function entityResource(entityType: ApprovalEntityType): string {
  return entityType === "JOB" ? ENTITY.JOB : ENTITY.OFFER;
}

/**
 * Configuring the chain is org-wide, not per-record — gated at ALL scope
 * specifically (see the ApprovalStepConfig model's own schema.prisma
 * comment), not just "any JOB:UPDATE grant." No seeded role currently
 * holds JOB:UPDATE/OFFER:UPDATE at ALL scope (see prisma/seed.ts) — the
 * same "super-admin only in practice" shape Organization settings and
 * SavedReport's run-due endpoint already document, not a bespoke
 * isSuperAdmin check here.
 */
async function assertAllScopeUpdate(context: SessionContext, entityType: ApprovalEntityType) {
  const scope = await getEffectiveScope(context, entityResource(entityType), "UPDATE");
  if (scope !== "ALL") {
    throw new ForbiddenError();
  }
}

export async function listApprovalStepConfigs(context: SessionContext, entityType: ApprovalEntityType) {
  const scope = await getEffectiveScope(context, entityResource(entityType), "READ");
  if (!scope) {
    throw new ForbiddenError();
  }
  return prisma.approvalStepConfig.findMany({
    where: { entityType },
    orderBy: { stepOrder: "asc" },
    include: { requiredRole: { select: { id: true, name: true } } },
  });
}

export async function replaceApprovalStepConfigs(
  context: SessionContext,
  entityType: ApprovalEntityType,
  input: ApprovalStepConfigsReplaceInput,
) {
  await assertAllScopeUpdate(context, entityType);

  if (input.steps.length > 0) {
    const roleIds = Array.from(new Set(input.steps.map((step) => step.requiredRoleId)));
    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
    if (roles.length !== roleIds.length) {
      throw new ValidationError("One or more requiredRoleId values do not match an existing role.");
    }
  }

  const before = await prisma.approvalStepConfig.findMany({ where: { entityType }, orderBy: { stepOrder: "asc" } });

  await prisma.$transaction(async (tx) => {
    await tx.approvalStepConfig.deleteMany({ where: { entityType } });
    if (input.steps.length > 0) {
      await tx.approvalStepConfig.createMany({
        data: input.steps.map((step) => ({
          entityType,
          stepOrder: step.stepOrder,
          name: step.name,
          requiredRoleId: step.requiredRoleId,
        })),
      });
    }
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.APPROVAL_STEP_CONFIG_UPDATED,
    entityType: ENTITY.APPROVAL_STEP_CONFIG,
    entityId: entityType,
    changes: {
      before: before.map((step) => ({ stepOrder: step.stepOrder, name: step.name, requiredRoleId: step.requiredRoleId })),
      after: input.steps,
    },
  });

  return listApprovalStepConfigs(context, entityType);
}

export type ApprovalStepSnapshot = {
  stepOrder: number;
  stepName: string | null;
  requiredRoleId: string | null;
  requiredRoleName: string | null;
};

/**
 * Called at SUBMIT time — snapshots the currently-configured chain onto
 * the entity's own JobApproval/OfferApproval rows (stepOrder/name/
 * requiredRoleId/requiredRoleName), or produces exactly one legacy row
 * (stepOrder 1, no snapshot) when no chain is configured, preserving the
 * original single-step behavior byte-for-byte. Takes `tx` so the read is
 * consistent with whatever transaction is about to write the rows.
 */
export async function buildApprovalStepSnapshots(
  client: PrismaClientOrTx,
  entityType: ApprovalEntityType,
): Promise<ApprovalStepSnapshot[]> {
  const configs = await client.approvalStepConfig.findMany({
    where: { entityType },
    orderBy: { stepOrder: "asc" },
    include: { requiredRole: { select: { name: true } } },
  });
  if (configs.length === 0) {
    return [{ stepOrder: 1, stepName: null, requiredRoleId: null, requiredRoleName: null }];
  }
  return configs.map((config) => ({
    stepOrder: config.stepOrder,
    stepName: config.name,
    requiredRoleId: config.requiredRoleId,
    requiredRoleName: config.requiredRole.name,
  }));
}

type DecidableStep = { id: string; stepOrder: number; status: string; requiredRoleId: string | null };

/** The one step a decision can currently act on — the lowest-stepOrder PENDING row, or null if none remain. */
export function selectCurrentPendingStep<T extends DecidableStep>(steps: T[]): T | null {
  const pending = steps.filter((step) => step.status === "PENDING");
  if (pending.length === 0) return null;
  return pending.reduce((min, step) => (step.stepOrder < min.stepOrder ? step : min));
}

/**
 * A step with no requiredRoleId is the legacy no-chain row — the caller's
 * own base permission check (assertJobAccess/assertOfferAccess against
 * APPROVE) is the only gate for it, preserving today's single-step
 * behavior. A configured step additionally requires the actor to hold
 * that step's specific role — different steps can need different
 * approvers (e.g. Hiring Manager, then Finance) without widening who
 * simply *has* the entity's APPROVE permission.
 */
export function assertCanDecideStep(context: SessionContext, step: DecidableStep) {
  if (context.isSuperAdmin) return;
  if (!step.requiredRoleId) return;
  if (!context.roles.some((role) => role.id === step.requiredRoleId)) {
    throw new ForbiddenError("This approval step requires a specific role you do not hold.");
  }
}

/** True once deciding `decidedStepId` would leave no other PENDING rows — the chain is done. */
export function isChainComplete<T extends DecidableStep>(steps: T[], decidedStepId: string): boolean {
  return !steps.some((step) => step.id !== decidedStepId && step.status === "PENDING");
}
