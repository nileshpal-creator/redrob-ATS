import type { PermissionAction } from "@/generated/prisma/enums";
import { can } from "@/lib/authz/authorize";
import { getSessionContext } from "@/lib/authz/session-context";

/**
 * Server-only convenience wrapper for conditionally rendering UI by
 * permission. This is a courtesy for a cleaner default experience — it is
 * NOT the security boundary. Every route/action this gate protects must
 * independently call `requirePermission` server-side; a user who forges a
 * request around a hidden button must still be denied by the API.
 */
export async function PermissionGate({
  resource,
  action,
  ownerId,
  fallback = null,
  children,
}: {
  resource: string;
  action: PermissionAction;
  ownerId?: string | null;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    return fallback;
  }

  const allowed = await can(context, resource, action, { ownerId });
  return allowed ? children : fallback;
}
