import type { PermissionAction } from "@/generated/prisma/enums";
import { can } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ENTITY } from "@/lib/entity-registry";

export type AdminNavPermission =
  | { resource: string; action: PermissionAction }
  | { anyOf: { resource: string; action: PermissionAction }[] };

/**
 * Single source of truth for "what permission makes this admin nav item
 * both visible in the sidebar AND successfully loadable" — keyed by the
 * same href used in src/config/nav.ts's `adminNav`. (app)/layout.tsx
 * consumes this directly to compute sidebar visibility; every admin
 * page.tsx's own guardPage/redirect check should require exactly this same
 * resource/action (or, for an anyOf entry, the same OR condition) so the
 * two can never silently drift apart.
 *
 * This table only records what's needed to load a page's OWN primary data.
 * A page that also makes a second, differently-permissioned service call
 * for secondary/optional data (e.g. Users pulling a role picker's options
 * via listRoles, which needs ROLE:READ) must degrade that second call
 * gracefully (`.catch(() => [])`, the pattern already used in
 * admin/approval-chains/page.tsx for its own listRoles call) rather than
 * being modeled here as a second required permission — requiring it here
 * would hide the nav item from someone who could otherwise fully use the
 * page's core function.
 */
export const ADMIN_NAV_PERMISSIONS: Record<string, AdminNavPermission> = {
  "/admin/users": { resource: ENTITY.USER, action: "READ" },
  "/admin/roles": { resource: ENTITY.ROLE, action: "READ" },
  "/admin/custom-fields": { resource: ENTITY.CUSTOM_FIELD_DEFINITION, action: "READ" },
  "/admin/communication-templates": { resource: ENTITY.COMMUNICATION_TEMPLATE, action: "READ" },
  "/admin/interview-reminders": { resource: ENTITY.ORGANIZATION, action: "READ" },
  "/admin/offer-settings": { resource: ENTITY.ORGANIZATION, action: "READ" },
  // Mirrors admin/approval-chains/page.tsx's own redirect condition exactly:
  // the page itself computes canViewJob/canViewOffer independently (it
  // needs the two individual booleans, not just their OR, for its own
  // conditional rendering), but the *gate* — "can this user reach the page
  // at all" — is this same JOB:READ-or-OFFER:READ condition.
  "/admin/approval-chains": {
    anyOf: [
      { resource: ENTITY.JOB, action: "READ" },
      { resource: ENTITY.OFFER, action: "READ" },
    ],
  },
  "/admin/data-retention": { resource: ENTITY.ORGANIZATION, action: "READ" },
  "/admin/audit-log": { resource: ENTITY.AUDIT_LOG, action: "READ" },
};

export async function canAccessAdminNavItem(context: SessionContext, href: string): Promise<boolean> {
  const permission = ADMIN_NAV_PERMISSIONS[href];
  if (!permission) {
    return false;
  }
  if ("anyOf" in permission) {
    const results = await Promise.all(permission.anyOf.map((grant) => can(context, grant.resource, grant.action)));
    return results.some(Boolean);
  }
  return can(context, permission.resource, permission.action);
}
