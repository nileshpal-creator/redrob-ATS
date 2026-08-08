import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { OfferStatus, PermissionAction } from "@/generated/prisma/enums";
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
import { findTransition, type OfferTransition } from "@/lib/offers/status-machine";
import type { OfferCreateInput, OfferQuery, OfferTransitionInput, OfferUpdateInput } from "@/lib/validations/offer";
import {
  assertCanDecideStep,
  buildApprovalStepSnapshots,
  isChainComplete,
  selectCurrentPendingStep,
} from "@/lib/services/approvals";
import { assertApplicationNotHandedOff, createHandoffForOffer } from "@/lib/services/handoffs";

const NON_TERMINAL_STATUSES: OfferStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "EXTENDED"];

const userSummarySelect = { id: true, name: true, email: true } as const;

const offerListInclude = {
  application: {
    select: {
      id: true,
      candidate: { select: { id: true, name: true } },
      job: { select: { id: true, title: true } },
    },
  },
  createdBy: { select: userSummarySelect },
} satisfies Prisma.OfferInclude;

const offerDetailInclude = {
  ...offerListInclude,
  outcomeReason: true,
  approvals: {
    // Chronological, not stepOrder alone — a resubmit-after-reject cycle
    // creates a fresh batch of rows alongside the old cycle's (REJECTED/
    // SKIPPED) rows, and this keeps each cycle's steps grouped together in
    // the order they were created rather than interleaving cycles that
    // happen to share the same stepOrder values.
    orderBy: [{ createdAt: "asc" }, { stepOrder: "asc" }],
    include: { approver: { select: userSummarySelect } },
  },
} satisfies Prisma.OfferInclude;

type OfferOwnership = { createdById: string };

async function assertControlledListValue(listKey: string, valueId: string, fieldLabel: string) {
  const value = await prisma.controlledListValue.findUnique({
    where: { id: valueId },
    include: { list: true },
  });
  if (!value || !value.isActive || value.list.key !== listKey) {
    throw new ValidationError(`Invalid ${fieldLabel}.`);
  }
}

async function validateOfferCustomFields(customFields: Record<string, unknown> | undefined) {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: ENTITY.OFFER, isActive: true },
  });
  if (definitions.length === 0) {
    return {};
  }
  return buildCustomFieldValueSchema(definitions).parse(customFields ?? {});
}

/**
 * Offer has one ownership facet — whoever drafted it (Offer.createdById),
 * mirroring Job.primaryRecruiterId — unlike Interview's scheduler/panelist
 * split. A single assertOfferAccess covers every action, including
 * APPROVE/REJECT: the PRD gives Offer approval to Hiring Manager as an
 * ALL-scope grant (prisma/seed.ts), not a per-offer assigned approver, the
 * same choice Job's assertJobAccess makes for its own APPROVE step.
 */
async function assertOfferAccess(context: SessionContext, offer: OfferOwnership, action: PermissionAction) {
  if (await can(context, ENTITY.OFFER, action)) return;
  if (await can(context, ENTITY.OFFER, action, { ownerId: offer.createdById })) return;
  throw new ForbiddenError();
}

function assertDraft(offer: { status: string }, actionLabel: string) {
  if (offer.status !== "DRAFT") {
    throw new ValidationError(`This offer is ${offer.status.toLowerCase()} and can no longer be ${actionLabel}.`);
  }
}

export async function listOffers(context: SessionContext, query: OfferQuery) {
  const scope = await getEffectiveScope(context, ENTITY.OFFER, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }
  const fieldAccess = await getFieldAccess(context, ENTITY.OFFER);

  let ownerFilter: Prisma.OfferWhereInput = {};
  if (scope === "OWN") {
    ownerFilter = { createdById: context.userId };
  } else if (scope === "TEAM") {
    const teamIds = await getTeamMemberIds(context.userId);
    ownerFilter = { createdById: { in: teamIds } };
  }

  const where: Prisma.OfferWhereInput = {
    ...ownerFilter,
    applicationId: query.applicationId,
    status: query.status,
  };

  const [offers, total] = await Promise.all([
    prisma.offer.findMany({
      where,
      include: offerDetailInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.offer.count({ where }),
  ]);

  return { offers: sanitizeManyForRead(offers, fieldAccess), total, page: query.page, pageSize: query.pageSize };
}

export async function getOffer(context: SessionContext, id: string) {
  const offer = await prisma.offer.findUnique({ where: { id }, include: offerDetailInclude });
  if (!offer) {
    throw new NotFoundError("Offer not found.");
  }
  await assertOfferAccess(context, offer, "READ");
  const fieldAccess = await getFieldAccess(context, ENTITY.OFFER);
  return sanitizeForRead(offer, fieldAccess);
}

export async function createOffer(context: SessionContext, input: OfferCreateInput) {
  await requirePermission(context, ENTITY.OFFER, "CREATE");

  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, outcome: true },
  });
  if (!application) {
    throw new ValidationError("Application not found.");
  }
  if (application.outcome !== "ACTIVE") {
    throw new ValidationError(
      `This application is already ${application.outcome.toLowerCase()} and cannot have offers created.`,
    );
  }
  await assertApplicationNotHandedOff(input.applicationId);

  const activeOffer = await prisma.offer.findFirst({
    where: { applicationId: input.applicationId, status: { in: NON_TERMINAL_STATUSES } },
    select: { id: true },
  });
  if (activeOffer) {
    throw new ValidationError("This application already has an offer in progress. Revoke it before creating a new one.");
  }

  const customFields = await validateOfferCustomFields(input.customFields);

  const fieldAccess = await getFieldAccess(context, ENTITY.OFFER);
  assertWritableFields({ ...input, customFields }, fieldAccess);

  // The findFirst above is a courtesy for a clean error message — it can't
  // prevent two concurrent creates from both passing it, so the
  // offer_one_active_per_application partial unique index (see the Offer
  // model's comment in schema.prisma) is the real guard. Without this
  // catch, a race loses to an unhandled 500 instead of the same
  // ValidationError the check above was written to produce.
  const created = await prisma.offer
    .create({
      data: {
        applicationId: input.applicationId,
        compensation: input.compensation,
        expectedJoiningDate: input.expectedJoiningDate,
        designation: input.designation,
        location: input.location,
        notes: input.notes,
        customFields: customFields as Prisma.InputJsonValue,
        createdById: context.userId,
      },
      include: offerDetailInclude,
    })
    .catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ValidationError("This application already has an offer in progress. Revoke it before creating a new one.");
      }
      throw error;
    });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.OFFER_CREATED,
    entityType: ENTITY.OFFER,
    entityId: created.id,
    changes: { after: { applicationId: input.applicationId, compensation: input.compensation } },
  });

  return sanitizeForRead(created, fieldAccess);
}

export async function updateOffer(context: SessionContext, id: string, input: OfferUpdateInput) {
  const existing = await prisma.offer.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Offer not found.");
  }
  await assertOfferAccess(context, existing, "UPDATE");
  assertDraft(existing, "edited");

  const customFields =
    input.customFields !== undefined ? await validateOfferCustomFields(input.customFields) : undefined;

  const fieldAccess = await getFieldAccess(context, ENTITY.OFFER);
  assertWritableFields({ ...input, ...(customFields !== undefined && { customFields }) }, fieldAccess);

  const data: Prisma.OfferUncheckedUpdateManyInput = {
    ...(input.compensation !== undefined && { compensation: input.compensation }),
    ...(input.expectedJoiningDate !== undefined && { expectedJoiningDate: input.expectedJoiningDate }),
    ...(input.designation !== undefined && { designation: input.designation }),
    ...(input.location !== undefined && { location: input.location }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(customFields !== undefined && { customFields: customFields as Prisma.InputJsonValue }),
    version: { increment: 1 },
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.offer.updateMany({ where: { id, version: input.version }, data });
    if (result.count === 0) {
      throw new ConflictError("This offer was changed by someone else. Reload and try again.");
    }
    return tx.offer.findUniqueOrThrow({ where: { id }, include: offerDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.OFFER_UPDATED,
    entityType: ENTITY.OFFER,
    entityId: id,
    changes: { before: existing, after: data },
  });

  return sanitizeForRead(updated, fieldAccess);
}

export async function transitionOffer(context: SessionContext, id: string, input: OfferTransitionInput) {
  const existing = await prisma.offer.findUnique({
    where: { id },
    include: { application: { select: { jobId: true } } },
  });
  if (!existing) {
    throw new NotFoundError("Offer not found.");
  }

  const transition = findTransition(existing.status, input.action);
  if (!transition) {
    throw new ValidationError(`Cannot ${input.action} an offer in ${existing.status} status.`);
  }

  await assertOfferAccess(context, existing, transition.requiredAction);

  if (transition.reasonRequired) {
    if (!input.reasonId) {
      throw new ValidationError("A reason is required for this transition.");
    }
    await assertControlledListValue(transition.reasonListKey!, input.reasonId, "reason");
  }

  if (input.action === "APPROVE" || input.action === "REJECT") {
    return decideOfferApprovalStep(context, id, existing, input, transition);
  }

  const { offer: updated, handoff } = await prisma.$transaction(async (tx) => {
    let handoffResult: { id: string; status: string } | null = null;

    const result = await tx.offer.updateMany({
      where: { id, version: input.version },
      data: {
        status: transition.to,
        ...(transition.reasonRequired && { outcomeReasonId: input.reasonId }),
        ...(input.action === "EXTEND" && { respondByDate: input.respondByDate ?? null }),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictError("This offer was changed by someone else. Reload and try again.");
    }

    // §11.6: "Configurable approval steps." The chain is snapshotted onto
    // OfferApproval at the moment an Offer is actually submitted — see
    // buildApprovalStepSnapshots's own comment for why this must be a
    // snapshot, not a live reference to ApprovalStepConfig.
    if (input.action === "SUBMIT") {
      const steps = await buildApprovalStepSnapshots(tx, "OFFER");
      await tx.offerApproval.createMany({ data: steps.map((step) => ({ offerId: id, ...step })) });
    } else if (input.action === "ACCEPT") {
      // §11.6: the Offer module is what actually fills a position — Job's
      // positionsFilledCount otherwise never moves off its default 0 (see
      // docs/project-status.md's "Known limitations"). A plain atomic
      // increment, not a version-checked update: this is a derived counter
      // Job's own edit form never touches, not a user-facing edit Job's
      // optimistic lock needs to guard.
      await tx.job.update({ where: { id: existing.application.jobId }, data: { positionsFilledCount: { increment: 1 } } });

      // §11.7: an accepted Offer is what actually triggers the onboarding
      // handoff — see the HandoffRecord model comment in schema.prisma.
      handoffResult = await createHandoffForOffer(tx, context, id, existing.applicationId);
    }

    const offer = await tx.offer.findUniqueOrThrow({ where: { id }, include: offerDetailInclude });
    return { offer, handoff: handoffResult };
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.OFFER_STATUS_CHANGED,
    entityType: ENTITY.OFFER,
    entityId: id,
    changes: { before: { status: existing.status }, after: { status: transition.to, action: input.action } },
  });

  if (handoff) {
    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.HANDOFF_INITIATED,
      entityType: ENTITY.HANDOFF,
      entityId: handoff.id,
      changes: { after: { status: handoff.status, offerId: id } },
    });
  }

  const fieldAccess = await getFieldAccess(context, ENTITY.OFFER);
  return sanitizeForRead(updated, fieldAccess);
}

/**
 * APPROVE/REJECT act on the single current step (lowest stepOrder among
 * PENDING rows), not directly on Offer.status — mirrors
 * decideJobApprovalStep in src/lib/services/jobs.ts exactly, reusing the
 * same shared helpers from src/lib/services/approvals.ts. REJECT always
 * fails the whole chain immediately (existing single-step semantics
 * preserved) and marks every other still-PENDING row SKIPPED. APPROVE
 * only flips Offer.status to the transition table's `to` once no PENDING
 * rows remain — an intermediate approval (more steps still pending)
 * records the decision but leaves Offer.status at PENDING_APPROVAL for
 * the next approver.
 */
async function decideOfferApprovalStep(
  context: SessionContext,
  id: string,
  existing: { status: OfferStatus },
  input: OfferTransitionInput,
  transition: OfferTransition,
) {
  const steps = await prisma.offerApproval.findMany({ where: { offerId: id } });
  const currentStep = selectCurrentPendingStep(steps);
  if (!currentStep) {
    throw new ValidationError("No pending approval step found for this offer.");
  }
  assertCanDecideStep(context, currentStep);

  const decision = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
  const chainWillComplete = input.action === "REJECT" || isChainComplete(steps, currentStep.id);

  const updated = await prisma.$transaction(async (tx) => {
    const decided = await tx.offerApproval.updateMany({
      where: { id: currentStep.id, status: "PENDING" },
      data: { status: decision, approverId: context.userId, comments: input.comments, decidedAt: new Date() },
    });
    if (decided.count === 0) {
      throw new ConflictError("This approval step was already decided by someone else. Reload and try again.");
    }

    if (input.action === "REJECT") {
      await tx.offerApproval.updateMany({
        where: { offerId: id, status: "PENDING", id: { not: currentStep.id } },
        data: { status: "SKIPPED" },
      });
    }

    if (chainWillComplete) {
      const result = await tx.offer.updateMany({
        where: { id, version: input.version },
        data: { status: transition.to, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictError("This offer was changed by someone else. Reload and try again.");
      }
    }

    return tx.offer.findUniqueOrThrow({ where: { id }, include: offerDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.OFFER_APPROVAL_STEP_DECIDED,
    entityType: ENTITY.OFFER,
    entityId: id,
    changes: { after: { stepOrder: currentStep.stepOrder, decision, chainComplete: chainWillComplete } },
  });

  if (chainWillComplete) {
    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.OFFER_STATUS_CHANGED,
      entityType: ENTITY.OFFER,
      entityId: id,
      changes: { before: { status: existing.status }, after: { status: transition.to, action: input.action } },
    });
  }

  const fieldAccess = await getFieldAccess(context, ENTITY.OFFER);
  return sanitizeForRead(updated, fieldAccess);
}
