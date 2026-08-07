import { prisma } from "@/lib/prisma";
import type { SessionContext } from "./session-context";

/**
 * Same DB lookup getSessionContext uses, minus the HTTP session — for
 * callers with no request to resolve one from (e.g. the scheduled-report
 * runner, src/lib/services/scheduled-reports.ts, which must re-apply a
 * SavedReport's *creator's* own RBAC scope, not a signed-in viewer's).
 *
 * Deliberately its own file, not colocated with getSessionContext:
 * session-context.ts imports next-auth's `auth()`, an entirely unrelated
 * dependency for what is otherwise a plain user-id lookup — pulling it in
 * transitively breaks importing this function outside the Next.js runtime
 * (next-auth's ESM/CJS interop with `next/server` doesn't resolve under
 * Vitest, which is exactly where scheduled-reports.ts's tests need this).
 * `import type` below (erased at compile time, no runtime import emitted)
 * is what keeps that coupling from creeping back in.
 */
export async function getSessionContextForUser(userId: string): Promise<SessionContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      roles: {
        select: {
          role: { select: { id: true, name: true, isSuperAdmin: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  const roles = user.roles.map((userRole) => userRole.role);

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roles,
    isSuperAdmin: roles.some((role) => role.isSuperAdmin),
  };
}
