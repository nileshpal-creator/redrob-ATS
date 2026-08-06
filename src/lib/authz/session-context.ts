import { cache } from "react";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type SessionRole = {
  id: string;
  name: string;
  isSuperAdmin: boolean;
};

export type SessionContext = {
  userId: string;
  name: string;
  email: string;
  roles: SessionRole[];
  isSuperAdmin: boolean;
};

/**
 * Resolves the signed-in user's roles fresh from the database on every call
 * (memoized per request via React's `cache`). Roles/permissions are
 * deliberately NOT read from the JWT: a permission or role change must take
 * effect on the user's very next request, not after their session cookie
 * expires. See src/lib/auth/auth.config.ts for what *is* safe to cache in
 * the token (just the user id).
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
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
});
