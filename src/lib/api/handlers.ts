import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getSessionContext, type SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Wraps a route handler with: session resolution (401 if absent), and a
 * single place mapping domain errors to HTTP status codes. Every
 * `/api/**` route in this codebase should be written as the callback passed
 * here rather than hand-rolling try/catch — see /admin API routes for the
 * pattern. `params` matches Next.js 15's async dynamic-segment params for
 * routes like `/api/custom-fields/[id]`; static routes leave the type
 * parameter at its default and ignore the third callback argument.
 */
export function withApiHandler<T, P = Record<string, never>>(
  handler: (context: SessionContext, request: Request, params: P) => Promise<T>,
) {
  return async (request: Request, routeContext: { params: Promise<P> }) => {
    try {
      const context = await getSessionContext();
      if (!context) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const params = await routeContext.params;
      const result = await handler(context, request, params);
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid input", issues: error.issues }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
