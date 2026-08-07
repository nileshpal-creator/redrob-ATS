import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ENTITY } from "@/lib/entity-registry";
import { can, ForbiddenError, getEffectiveScope, getTeamMemberIds, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import type { PermissionAction } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { buildCustomFieldValueSchema } from "@/lib/custom-fields/dynamic-schema";
import type {
  InterviewCancelInput,
  InterviewCompleteInput,
  InterviewCreateInput,
  InterviewFeedbackCreateInput,
  InterviewFeedbackUpdateInput,
  InterviewQuery,
  InterviewUpdateInput,
} from "@/lib/validations/interview";
import { assertApplicationNotHandedOff } from "@/lib/services/handoffs";

const userSummarySelect = { id: true, name: true, email: true } as const;

const interviewListInclude = {
  application: {
    select: {
      id: true,
      candidate: { select: { id: true, name: true } },
      job: { select: { id: true, title: true } },
    },
  },
  scheduledBy: { select: userSummarySelect },
  panelists: { include: { user: { select: userSummarySelect } } },
} satisfies Prisma.InterviewInclude;

const interviewDetailInclude = {
  ...interviewListInclude,
  cancellationReason: true,
  feedback: {
    orderBy: { submittedAt: "desc" },
    include: { interviewer: { select: userSummarySelect } },
  },
} satisfies Prisma.InterviewInclude;

type InterviewOwnership = { scheduledById: string; panelists: { userId: string }[] };

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
    throw new ValidationError(`${fieldLabel} must all be active users.`);
  }
  return uniqueIds;
}

async function validateInterviewCustomFields(customFields: Record<string, unknown> | undefined) {
  const definitions = await prisma.customFieldDefinition.findMany({
    where: { entityType: ENTITY.INTERVIEW, isActive: true },
  });
  if (definitions.length === 0) {
    return {};
  }
  return buildCustomFieldValueSchema(definitions).parse(customFields ?? {});
}

/**
 * Interview has two independent ownership facets, unlike every prior
 * module's single ownerId column: whoever scheduled it (mirrors
 * Job.primaryRecruiterId / Application.ownerId) and whoever is assigned to
 * conduct it (a panelist never scheduled the interview, but still needs to
 * read it and file feedback on it).
 *
 * These are two deliberately different checks, not one: `assertManageAccess`
 * (reschedule/cancel/complete — scheduling-side decisions) only ever
 * resolves against `scheduledById`, so being on the panel never by itself
 * grants the right to move, cancel, or complete someone else's interview.
 * `assertReadOrFeedbackAccess` (read, and — combined with the separate
 * assertIsPanelist business-rule check below — feedback) additionally
 * accepts panelist membership, reusing can()'s existing OWN-scope semantics
 * verbatim by resolving OWN against context.userId once panelist membership
 * is independently confirmed, rather than teaching authorize.ts a second
 * ownership column.
 */
async function assertManageAccess(
  context: SessionContext,
  interview: Pick<InterviewOwnership, "scheduledById">,
  action: PermissionAction,
) {
  if (await can(context, ENTITY.INTERVIEW, action)) return;
  if (await can(context, ENTITY.INTERVIEW, action, { ownerId: interview.scheduledById })) return;
  throw new ForbiddenError();
}

async function assertReadOrFeedbackAccess(
  context: SessionContext,
  interview: InterviewOwnership,
  action: PermissionAction,
) {
  if (await can(context, ENTITY.INTERVIEW, action)) return;
  if (await can(context, ENTITY.INTERVIEW, action, { ownerId: interview.scheduledById })) return;

  const isPanelist = interview.panelists.some((panelist) => panelist.userId === context.userId);
  if (isPanelist && (await can(context, ENTITY.INTERVIEW, action, { ownerId: context.userId }))) return;

  throw new ForbiddenError();
}

async function buildScopedWhere(
  context: SessionContext,
  query: Pick<InterviewQuery, "applicationId" | "panelistUserId" | "status">,
): Promise<Prisma.InterviewWhereInput> {
  const scope = await getEffectiveScope(context, ENTITY.INTERVIEW, "READ");
  if (!scope) {
    throw new ForbiddenError();
  }

  let ownerFilter: Prisma.InterviewWhereInput = {};
  if (scope === "OWN") {
    // OWN covers both facets: interviews the caller scheduled, and
    // interviews the caller is a panelist on.
    ownerFilter = {
      OR: [{ scheduledById: context.userId }, { panelists: { some: { userId: context.userId } } }],
    };
  } else if (scope === "TEAM") {
    const teamIds = await getTeamMemberIds(context.userId);
    ownerFilter = { scheduledById: { in: teamIds } };
  }

  return {
    applicationId: query.applicationId,
    status: query.status,
    ...(query.panelistUserId ? { panelists: { some: { userId: query.panelistUserId } } } : {}),
    ...ownerFilter,
  };
}

export async function listInterviews(context: SessionContext, query: InterviewQuery) {
  const where = await buildScopedWhere(context, query);

  const [interviews, total] = await Promise.all([
    prisma.interview.findMany({
      where,
      include: interviewDetailInclude,
      orderBy: { scheduledAt: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.interview.count({ where }),
  ]);

  return { interviews, total, page: query.page, pageSize: query.pageSize };
}

export async function getInterview(context: SessionContext, id: string) {
  const interview = await prisma.interview.findUnique({ where: { id }, include: interviewDetailInclude });
  if (!interview) {
    throw new NotFoundError("Interview not found.");
  }
  await assertReadOrFeedbackAccess(context, interview, "READ");
  return interview;
}

export async function scheduleInterview(context: SessionContext, input: InterviewCreateInput) {
  await requirePermission(context, ENTITY.INTERVIEW, "CREATE");

  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, outcome: true },
  });
  if (!application) {
    throw new ValidationError("Application not found.");
  }
  if (application.outcome !== "ACTIVE") {
    throw new ValidationError(
      `This application is already ${application.outcome.toLowerCase()} and cannot have interviews scheduled.`,
    );
  }
  await assertApplicationNotHandedOff(input.applicationId);

  const panelistIds = await assertActiveUsers(input.panelistUserIds, "Interviewer");
  const customFields = await validateInterviewCustomFields(input.customFields);

  const created = await prisma.$transaction(async (tx) => {
    const interview = await tx.interview.create({
      data: {
        applicationId: input.applicationId,
        roundName: input.roundName,
        mode: input.mode,
        location: input.location,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes ?? 60,
        notes: input.notes,
        customFields: customFields as Prisma.InputJsonValue,
        scheduledById: context.userId,
        panelists: { createMany: { data: panelistIds.map((userId) => ({ userId })) } },
      },
    });

    return tx.interview.findUniqueOrThrow({ where: { id: interview.id }, include: interviewDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.INTERVIEW_SCHEDULED,
    entityType: ENTITY.INTERVIEW,
    entityId: created.id,
    changes: { after: { applicationId: input.applicationId, roundName: input.roundName, scheduledAt: input.scheduledAt } },
  });

  return created;
}

function assertScheduled(interview: { status: string }, actionLabel: string) {
  if (interview.status !== "SCHEDULED") {
    throw new ValidationError(
      `This interview is already ${interview.status.toLowerCase()} and cannot be ${actionLabel}.`,
    );
  }
}

export async function updateInterview(context: SessionContext, id: string, input: InterviewUpdateInput) {
  const existing = await prisma.interview.findUnique({ where: { id }, include: { panelists: true } });
  if (!existing) {
    throw new NotFoundError("Interview not found.");
  }
  await assertManageAccess(context, existing, "UPDATE");
  assertScheduled(existing, "rescheduled or edited");

  const panelistIds = input.panelistUserIds
    ? await assertActiveUsers(input.panelistUserIds, "Interviewer")
    : undefined;
  const customFields =
    input.customFields !== undefined ? await validateInterviewCustomFields(input.customFields) : undefined;

  const data: Prisma.InterviewUncheckedUpdateManyInput = {
    ...(input.roundName !== undefined && { roundName: input.roundName }),
    ...(input.mode !== undefined && { mode: input.mode }),
    ...(input.location !== undefined && { location: input.location }),
    ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
    ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(customFields !== undefined && { customFields: customFields as Prisma.InputJsonValue }),
    version: { increment: 1 },
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.interview.updateMany({ where: { id, version: input.version }, data });
    if (result.count === 0) {
      throw new ConflictError("This interview was changed by someone else. Reload and try again.");
    }

    if (panelistIds) {
      await tx.interviewPanelist.deleteMany({ where: { interviewId: id } });
      await tx.interviewPanelist.createMany({
        data: panelistIds.map((userId) => ({ interviewId: id, userId })),
      });
    }

    return tx.interview.findUniqueOrThrow({ where: { id }, include: interviewDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.INTERVIEW_UPDATED,
    entityType: ENTITY.INTERVIEW,
    entityId: id,
    changes: { before: existing, after: data },
  });

  return updated;
}

export async function cancelInterview(context: SessionContext, id: string, input: InterviewCancelInput) {
  const existing = await prisma.interview.findUnique({ where: { id }, include: { panelists: true } });
  if (!existing) {
    throw new NotFoundError("Interview not found.");
  }
  await assertManageAccess(context, existing, "UPDATE");
  assertScheduled(existing, "cancelled");
  await assertControlledListValue("INTERVIEW_CANCELLATION_REASON", input.reasonId, "reason");

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.interview.updateMany({
      where: { id, version: input.version },
      data: { status: "CANCELLED", cancellationReasonId: input.reasonId, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError("This interview was changed by someone else. Reload and try again.");
    }
    return tx.interview.findUniqueOrThrow({ where: { id }, include: interviewDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.INTERVIEW_CANCELLED,
    entityType: ENTITY.INTERVIEW,
    entityId: id,
    changes: { before: { status: existing.status }, after: { status: "CANCELLED", reasonId: input.reasonId, note: input.note } },
  });

  return updated;
}

export async function completeInterview(context: SessionContext, id: string, input: InterviewCompleteInput) {
  const existing = await prisma.interview.findUnique({ where: { id }, include: { panelists: true } });
  if (!existing) {
    throw new NotFoundError("Interview not found.");
  }
  await assertManageAccess(context, existing, "UPDATE");
  assertScheduled(existing, "marked complete");

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.interview.updateMany({
      where: { id, version: input.version },
      data: { status: "COMPLETED", version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError("This interview was changed by someone else. Reload and try again.");
    }
    return tx.interview.findUniqueOrThrow({ where: { id }, include: interviewDetailInclude });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.INTERVIEW_COMPLETED,
    entityType: ENTITY.INTERVIEW,
    entityId: id,
    changes: { before: { status: existing.status }, after: { status: "COMPLETED", note: input.note } },
  });

  return updated;
}

/**
 * Feedback authorship is checked directly against panelist membership, on
 * top of (not instead of) assertReadOrFeedbackAccess — a Recruiter/
 * Recruiting Manager can have UPDATE access to the interview (they
 * scheduled it, or hold an ALL/TEAM grant) without ever being allowed to
 * file feedback as if they were one of its interviewers.
 */
function assertIsPanelist(interview: { panelists: { userId: string }[] }, context: SessionContext) {
  if (!interview.panelists.some((panelist) => panelist.userId === context.userId)) {
    throw new ForbiddenError("You are not an assigned interviewer for this interview.");
  }
}

export async function submitInterviewFeedback(
  context: SessionContext,
  interviewId: string,
  input: InterviewFeedbackCreateInput,
) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: { panelists: true } });
  if (!interview) {
    throw new NotFoundError("Interview not found.");
  }
  await assertReadOrFeedbackAccess(context, interview, "UPDATE");
  assertIsPanelist(interview, context);

  if (interview.status === "CANCELLED") {
    throw new ValidationError("Cannot submit feedback for a cancelled interview.");
  }

  const existing = await prisma.interviewFeedback.findUnique({
    where: { interviewId_interviewerId: { interviewId, interviewerId: context.userId } },
  });
  if (existing) {
    throw new ConflictError("You have already submitted feedback for this interview. Use update instead.");
  }

  // The findUnique above is a courtesy for a clean error message — it can't
  // prevent two concurrent submissions from both passing it, so the
  // @@unique([interviewId, interviewerId]) constraint is the real guard.
  // Without this catch, a race loses to an unhandled 500 instead of the
  // 409 the check above was written to produce.
  const created = await prisma.interviewFeedback
    .create({
      data: {
        interviewId,
        interviewerId: context.userId,
        recommendation: input.recommendation,
        rating: input.rating,
        comments: input.comments,
      },
      include: { interviewer: { select: userSummarySelect } },
    })
    .catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictError("You have already submitted feedback for this interview. Use update instead.");
      }
      throw error;
    });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.INTERVIEW_FEEDBACK_SUBMITTED,
    entityType: ENTITY.INTERVIEW,
    entityId: interviewId,
    changes: { after: { recommendation: input.recommendation, rating: input.rating ?? null } },
  });

  return created;
}

export async function updateInterviewFeedback(
  context: SessionContext,
  interviewId: string,
  input: InterviewFeedbackUpdateInput,
) {
  const existing = await prisma.interviewFeedback.findUnique({
    where: { interviewId_interviewerId: { interviewId, interviewerId: context.userId } },
  });
  if (!existing) {
    throw new NotFoundError("You have not submitted feedback for this interview yet.");
  }

  const data: Prisma.InterviewFeedbackUncheckedUpdateManyInput = {
    ...(input.recommendation !== undefined && { recommendation: input.recommendation }),
    ...(input.rating !== undefined && { rating: input.rating }),
    ...(input.comments !== undefined && { comments: input.comments }),
    version: { increment: 1 },
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.interviewFeedback.updateMany({
      where: { interviewId, interviewerId: context.userId, version: input.version },
      data,
    });
    if (result.count === 0) {
      throw new ConflictError("This feedback was changed by someone else. Reload and try again.");
    }

    return tx.interviewFeedback.findUniqueOrThrow({
      where: { interviewId_interviewerId: { interviewId, interviewerId: context.userId } },
      include: { interviewer: { select: userSummarySelect } },
    });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.INTERVIEW_FEEDBACK_SUBMITTED,
    entityType: ENTITY.INTERVIEW,
    entityId: interviewId,
    changes: { before: existing, after: data },
  });

  return updated;
}
