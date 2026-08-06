import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  CreateUserInput,
  UpdateUserRolesInput,
  UpdateUserStatusInput,
} from "@/lib/validations/user";

const userListSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  managerId: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const;

export async function listUsers(context: SessionContext) {
  await requirePermission(context, ENTITY.USER, "READ");

  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: userListSelect,
  });
}

export async function createUser(context: SessionContext, input: CreateUserInput) {
  await requirePermission(context, ENTITY.USER, "CREATE");

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ValidationError(`A user with email "${input.email}" already exists.`);
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const created = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      managerId: input.managerId ?? null,
      roles: { createMany: { data: input.roleIds.map((roleId) => ({ roleId })) } },
    },
    select: userListSelect,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: ENTITY.USER,
    entityId: created.id,
    changes: { after: { name: created.name, email: created.email, roleIds: input.roleIds } },
  });

  return created;
}

export async function updateUserRoles(
  context: SessionContext,
  userId: string,
  input: UpdateUserRolesInput,
) {
  await requirePermission(context, ENTITY.USER, "UPDATE");

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { roleId: true } } },
  });
  if (!before) {
    throw new NotFoundError("User not found.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({
      data: input.roleIds.map((roleId) => ({ userId, roleId })),
    });
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select: userListSelect });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.USER_ROLES_UPDATED,
    entityType: ENTITY.USER,
    entityId: userId,
    changes: {
      before: before.roles.map((role) => role.roleId),
      after: input.roleIds,
    },
  });

  return updated;
}

export async function updateUserStatus(
  context: SessionContext,
  userId: string,
  input: UpdateUserStatusInput,
) {
  await requirePermission(context, ENTITY.USER, "UPDATE");

  if (userId === context.userId && !input.isActive) {
    throw new ValidationError("You cannot deactivate your own account.");
  }

  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) {
    throw new NotFoundError("User not found.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive: input.isActive },
    select: userListSelect,
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: ENTITY.USER,
    entityId: userId,
    changes: { before: before.isActive, after: updated.isActive },
  });

  return updated;
}
