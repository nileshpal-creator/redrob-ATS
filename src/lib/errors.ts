/** Shared domain error types, mapped to HTTP status codes in src/lib/api/handlers.ts. */
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
/** Optimistic-locking failure: the caller's `version` no longer matches the row. */
export class ConflictError extends Error {}
/**
 * A hard duplicate (matching Candidate.phone) was found on create/import.
 * Carries the existing record's id so the caller can offer merge/link
 * instead of blind creation (§11.2).
 */
export class DuplicateCandidateError extends ConflictError {
  existingCandidateId: string;

  constructor(message: string, existingCandidateId: string) {
    super(message);
    this.existingCandidateId = existingCandidateId;
  }
}
