import { prisma } from "@/lib/prisma";
import type { PermissionAction } from "@/generated/prisma/enums";
import type { SessionContext } from "./session-context";

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

type OwnershipContext = {
  /** id of the user who owns/is assigned to the record being accessed */
  ownerId?: string | null;
};

/**
 * Core authorization check, enforced server-side (§10.3: "Permission sets
 * enforced server-side, not only hidden in the interface"). Every API route
 * and server action that touches a permission-gated resource must call this
 * — or the higher-level `requirePermission` — before reading or mutating
 * data. UI-level hiding (see PermissionGate) is a courtesy, never the
 * enforcement boundary.
 */
export async function can(
  context: SessionContext,
  resource: string,
  action: PermissionAction,
  ownership: OwnershipContext = {},
): Promise<boolean> {
  if (context.isSuperAdmin) {
    return true;
  }

  const roleIds = context.roles.map((role) => role.id);
  if (roleIds.length === 0) {
    return false;
  }

  const grants = await prisma.rolePermission.findMany({
    where: { roleId: { in: roleIds }, resource, action },
    select: { scope: true },
  });

  if (grants.length === 0) {
    return false;
  }

  if (grants.some((grant) => grant.scope === "ALL")) {
    return true;
  }

  if (ownership.ownerId === context.userId && grants.some((grant) => grant.scope === "OWN")) {
    return true;
  }

  if (grants.some((grant) => grant.scope === "TEAM")) {
    if (!ownership.ownerId) {
      return false;
    }
    const teamMemberIds = await getTeamMemberIds(context.userId);
    return teamMemberIds.includes(ownership.ownerId);
  }

  return false;
}

/** Throws ForbiddenError instead of returning false — use in API routes/server actions. */
export async function requirePermission(
  context: SessionContext,
  resource: string,
  action: PermissionAction,
  ownership: OwnershipContext = {},
): Promise<void> {
  const allowed = await can(context, resource, action, ownership);
  if (!allowed) {
    throw new ForbiddenError();
  }
}

/** The user themself plus their direct reports — see User.managerId. */
export async function getTeamMemberIds(userId: string): Promise<string[]> {
  const directReports = await prisma.user.findMany({
    where: { managerId: userId },
    select: { id: true },
  });

  return [userId, ...directReports.map((report) => report.id)];
}

export type FieldAccessMap = Record<string, "HIDDEN" | "READ" | "WRITE">;

/**
 * Resolves per-field visibility for a resource (§10.1: "Field-level
 * visibility rules by role, so sensitive custom fields ... are restricted
 * the same way core fields are"). Fields with no explicit FieldPermission
 * row default to READ — permission sets opt a role INTO restricting a
 * field, not into seeing it.
 */
export async function getFieldAccess(
  context: SessionContext,
  resource: string,
): Promise<FieldAccessMap> {
  if (context.isSuperAdmin) {
    return {};
  }

  const roleIds = context.roles.map((role) => role.id);
  if (roleIds.length === 0) {
    return {};
  }

  const rules = await prisma.fieldPermission.findMany({
    where: { roleId: { in: roleIds }, resource },
    select: { field: true, access: true },
  });

  const mostPermissiveFirst = { WRITE: 2, READ: 1, HIDDEN: 0 } as const;
  const access: FieldAccessMap = {};

  for (const rule of rules) {
    const current = access[rule.field];
    if (!current || mostPermissiveFirst[rule.access] > mostPermissiveFirst[current]) {
      access[rule.field] = rule.access;
    }
  }

  return access;
}
