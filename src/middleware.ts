import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth/auth.config";

// A second, edge-safe NextAuth instance built from the shared config — see
// the comment on authConfig for why this can't just import from "@/auth".
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
