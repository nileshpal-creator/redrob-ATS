import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the Auth.js config: no Prisma, no bcrypt, no Node-only
 * imports. `middleware.ts` builds its own NextAuth instance from this file so
 * route protection works without pulling the `pg` driver into the Edge
 * runtime. `src/auth.ts` extends this with the actual Credentials provider
 * and is used everywhere else (API routes, server components, server
 * actions), which all run in the Node.js runtime.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage = request.nextUrl.pathname.startsWith("/login");

      if (isAuthPage) {
        return !isLoggedIn || Response.redirect(new URL("/", request.nextUrl));
      }

      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
