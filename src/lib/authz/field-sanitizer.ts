import { ForbiddenError } from "./authorize";
import type { FieldAccessMap } from "./authorize";

/**
 * Real server-side enforcement of getFieldAccess() (§10.1: "Field-level
 * visibility rules by role... restricted the same way core fields are").
 * getFieldAccess() itself only *resolves* a role's per-field access map —
 * this module is what actually applies it to a read (mask HIDDEN fields) or
 * a write (reject setting a HIDDEN/READ field), so every service that
 * exposes a FieldPermission-capable resource (see
 * CUSTOM_FIELD_CAPABLE_ENTITIES in src/lib/entity-registry.ts) goes through
 * one shared choke point instead of scattering ad-hoc `delete obj.field`
 * calls per module.
 *
 * A restricted custom field is addressed as "customFields.<key>" in
 * FieldPermission.field — the same map this way covers both core columns
 * and admin-defined custom fields without a second mechanism, per the same
 * requirement's own "custom fields ... restricted the same way core fields
 * are."
 */
const CUSTOM_FIELD_PREFIX = "customFields.";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Removes (not merely nulls) every HIDDEN field from `data` before it can
 * reach a caller who isn't authorized to see it — the field is absent from
 * the returned object entirely, so it drops out of JSON responses, exports,
 * and anything else built from this object's own keys.
 */
export function sanitizeForRead<T extends Record<string, unknown>>(data: T, fieldAccess: FieldAccessMap): T {
  if (Object.keys(fieldAccess).length === 0) {
    return data;
  }

  const result: Record<string, unknown> = { ...data };

  for (const [field, access] of Object.entries(fieldAccess)) {
    if (access !== "HIDDEN") continue;

    if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
      const key = field.slice(CUSTOM_FIELD_PREFIX.length);
      if (isPlainRecord(result.customFields) && key in result.customFields) {
        const nextCustomFields = { ...result.customFields };
        delete nextCustomFields[key];
        result.customFields = nextCustomFields;
      }
      continue;
    }

    delete result[field];
  }

  return result as T;
}

export function sanitizeManyForRead<T extends Record<string, unknown>>(rows: T[], fieldAccess: FieldAccessMap): T[] {
  if (Object.keys(fieldAccess).length === 0) {
    return rows;
  }
  return rows.map((row) => sanitizeForRead(row, fieldAccess));
}

/**
 * Throws if `input` (a create/update payload, already Zod-parsed) tries to
 * set a field the caller only has HIDDEN or READ access to. Only fields
 * actually present as keys on `input` are checked — an omitted optional
 * field is simply not being written, not an attempt to clear it.
 */
export function assertWritableFields(input: Record<string, unknown>, fieldAccess: FieldAccessMap): void {
  for (const [field, access] of Object.entries(fieldAccess)) {
    if (access === "WRITE") continue;

    if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
      const key = field.slice(CUSTOM_FIELD_PREFIX.length);
      if (isPlainRecord(input.customFields) && key in input.customFields) {
        throw new ForbiddenError(`You do not have permission to set the "${key}" field.`);
      }
      continue;
    }

    if (field in input && input[field] !== undefined) {
      throw new ForbiddenError(`You do not have permission to set the "${field}" field.`);
    }
  }
}
