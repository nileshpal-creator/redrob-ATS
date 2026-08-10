import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth/auth.config";

// A second, edge-safe NextAuth instance built from the shared config — see
// the comment on authConfig for why this can't just import from "@/auth".
export const { auth: middleware } = NextAuth(authConfig);

// Excludes the entire /api prefix, not just /api/auth: every route under
// src/app/api/**/route.ts already resolves its own session via
// withApiHandler and returns a proper 401 JSON body when unauthenticated.
// Without this exclusion, an unauthenticated API request hit this
// page-oriented redirect-to-/login logic first and got a 307 HTML redirect
// instead of 401 JSON — correct for a browser navigating to a protected
// page, wrong for an API client (fetch, another service, an expired
// session) that expects a parseable error, not a redirect.
export const config = {
  // logo.png/icon.png: the brand mark, served from public/ (logo.png) and
  // the app-icon file convention (icon.png) — both need to load on the
  // signed-out /login page itself, so they're excluded the same way
  // favicon.ico already is.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|logo.png|icon.png).*)"],
};
