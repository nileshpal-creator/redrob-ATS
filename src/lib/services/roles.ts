import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { RoleInput, RolePermissionsUpdateInput, RoleUpdateInput } from "@/lib/validations/role";

export async function listRoles(context: SessionContext) {
  await requirePermission(context, ENTITY.ROLE, "READ");

  return prisma.role.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { users: true } },
      rolePermissions: true,
      fieldPermissions: true,
    },
  });
}

export async function createRole(context: SessionContext, input: RoleInput) {
  await requirePermission(context, ENTITY.ROLE, "CREATE");

  const existing = await prisma.role.findUnique({ where: { name: input.name } });
  if (existing) {
    throw new ValidationError(`A role named "${input.name}" already exists.`);
  }

  const created = await prisma.role.create({ data: input });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.ROLE_CREATED,
    entityType: ENTITY.ROLE,
    entityId: created.id,
    changes: { after: created },
  });

  return created;
}

export async function updateRole(
  context: SessionContext,
  id: string,
  input: RoleUpdateInput,
) {
  await requirePermission(context, ENTITY.ROLE, "UPDATE");

  const before = await prisma.role.findUnique({ where: { id } });
  if (!before) {
    throw new NotFoundError("Role not found.");
  }

  const updated = await prisma.role.update({ where: { id }, data: input });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    entityType: ENTITY.ROLE,
    entityId: updated.id,
    changes: { before, after: updated },
  });

  return updated;
}

export async function deleteRole(context: SessionContext, id: string) {
  await requirePermission(context, ENTITY.ROLE, "DELETE");

  const existing = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) {
    throw new NotFoundError("Role not found.");
  }
  if (existing.isSystem) {
    throw new ValidationError("System roles cannot be deleted.");
  }
  if (existing._count.users > 0) {
    throw new ValidationError(
      "This role is still assigned to users. Reassign them before deleting it.",
    );
  }

  await prisma.role.delete({ where: { id } });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.ROLE_DELETED,
    entityType: ENTITY.ROLE,
    entityId: id,
    changes: { before: existing },
  });
}

/** Bulk-replaces a role's permission grants — the matrix editor submits its full desired state. */
export async function replaceRolePermissions(
  context: SessionContext,
  roleId: string,
  input: RolePermissionsUpdateInput,
) {
  await requirePermission(context, ENTITY.ROLE, "UPDATE");

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    throw new NotFoundError("Role not found.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.fieldPermission.deleteMany({ where: { roleId } });

    if (input.permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: input.permissions.map((grant) => ({ ...grant, roleId })),
      });
    }
    if (input.fieldPermissions.length > 0) {
      await tx.fieldPermission.createMany({
        data: input.fieldPermissions.map((rule) => ({ ...rule, roleId })),
      });
    }

    return tx.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { rolePermissions: true, fieldPermissions: true },
    });
  });

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
    entityType: ENTITY.ROLE,
    entityId: roleId,
    changes: { after: { permissions: input.permissions, fieldPermissions: input.fieldPermissions } },
  });

  return updated;
}
