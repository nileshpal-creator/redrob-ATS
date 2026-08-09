import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { ForbiddenError, requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  ChangePasswordInput,
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

/**
 * Hard delete — a genuinely destructive, irreversible action, unlike
 * `updateUserStatus`'s reversible deactivate toggle. Restricted to super
 * admins outright (not just a USER:DELETE grant a custom role could hold):
 * stricter than this codebase's usual "the permission grant is the only
 * gate" convention (see `can()`'s doc comment in authorize.ts), deliberately
 * so here given the blast radius.
 *
 * User has a large fan-out of FK relations (jobs created, audit log actor,
 * candidate notes, etc. — see schema.prisma), almost all default-`Restrict`.
 * Rather than hand-maintain a `_count` guard across every one of them (the
 * pattern `deleteRole` uses for its two relations), this lets Postgres be
 * the source of truth and translates the resulting FK-violation into a
 * clean, actionable error — the same P2002-catch idiom `createCandidate`
 * uses for its own race condition, just for P2003 instead.
 */
export async function deleteUser(context: SessionContext, userId: string) {
  await requirePermission(context, ENTITY.USER, "DELETE");
  if (!context.isSuperAdmin) {
    throw new ForbiddenError("Only super admins can delete users.");
  }

  if (userId === context.userId) {
    throw new ValidationError("You cannot delete your own account.");
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!existing) {
    throw new NotFoundError("User not found.");
  }

  const isTargetSuperAdmin = existing.roles.some((userRole) => userRole.role.isSuperAdmin);
  if (isTargetSuperAdmin) {
    const otherSuperAdminCount = await prisma.user.count({
      where: { id: { not: userId }, isActive: true, roles: { some: { role: { isSuperAdmin: true } } } },
    });
    if (otherSuperAdminCount === 0) {
      throw new ValidationError("Cannot delete the last active super admin.");
    }
  }

  await prisma.user.delete({ where: { id: userId } }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "P2003") {
      throw new ValidationError(
        "This user has associated records (jobs, applications, audit history, etc.) and cannot be deleted. Deactivate the account instead.",
      );
    }
    throw error;
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.USER_DELETED,
    entityType: ENTITY.USER,
    entityId: userId,
    changes: { before: { name: existing.name, email: existing.email } },
  });
}

/** No RBAC check — every signed-in user may always view their own profile. */
export async function getOwnProfile(context: SessionContext) {
  return prisma.user.findUniqueOrThrow({
    where: { id: context.userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      lastLoginAt: true,
      createdAt: true,
      roles: { select: { role: { select: { id: true, name: true, isSuperAdmin: true } } } },
    },
  });
}

/**
 * Self-service password change — no RBAC gate (every signed-in user may
 * always change their own password), guarded instead by requiring the
 * current password, same as `authorize()`'s login check in src/auth.ts.
 */
export async function changePassword(context: SessionContext, input: ChangePasswordInput) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: context.userId } });

  const currentPasswordValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!currentPasswordValid) {
    throw new ValidationError("Current password is incorrect.");
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
    entityType: ENTITY.USER,
    entityId: user.id,
    changes: {},
  });
}
