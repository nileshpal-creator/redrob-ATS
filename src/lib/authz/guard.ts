import { redirect } from "next/navigation";

import type { PermissionAction } from "@/generated/prisma/enums";
import { can } from "./authorize";
import type { SessionContext } from "./session-context";

/**
 * Server Component guard: redirects instead of letting a ForbiddenError
 * cross the RSC boundary. Errors thrown in a Server Component surface to
 * the client as a generic 500 (Next.js strips the message/type in
 * production), so a user who navigates straight to a URL they lack
 * permission for would see a crash page instead of a clean redirect.
 * Service-layer `requirePermission` calls stay in place as the real
 * enforcement — this only makes the page-level failure mode graceful.
 */
export async function guardPage(
  context: SessionContext,
  resource: string,
  action: PermissionAction,
  redirectTo = "/",
) {
  const allowed = await can(context, resource, action);
  if (!allowed) {
    redirect(redirectTo);
  }
}
