/** Shared domain error types, mapped to HTTP status codes in src/lib/api/handlers.ts. */
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
/** Optimistic-locking failure: the caller's `version` no longer matches the row. */
export class ConflictError extends Error {}
