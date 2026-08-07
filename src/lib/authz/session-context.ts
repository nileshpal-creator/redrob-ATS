import { cache } from "react";

import { auth } from "@/auth";
import { getSessionContextForUser } from "./session-context-for-user";

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
 * the token (just the user id). The actual DB lookup lives in
 * session-context-for-user.ts, kept out of this file so importing it (e.g.
 * from a test) doesn't drag in next-auth's `auth()` — see that file's
 * comment.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  return getSessionContextForUser(session.user.id);
});
