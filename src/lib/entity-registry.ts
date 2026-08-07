/**
 * Central registry of resource keys used by the RBAC, custom-field, and audit
 * engines. `RolePermission.resource`, `FieldPermission.resource`,
 * `CustomFieldDefinition.entityType`, and `AuditLog.entityType` are plain
 * strings in the schema (see prisma/schema.prisma) so that adding a module
 * never requires a migration to those cross-cutting tables — it requires
 * adding one entry here instead.
 *
 * Every module's design doc must add its entities to this file before wiring
 * up permissions or custom fields for them.
 */

export const ENTITY = {
  USER: "USER",
  ROLE: "ROLE",
  ORGANIZATION: "ORGANIZATION",
  CONTROLLED_LIST: "CONTROLLED_LIST",
  CUSTOM_FIELD_DEFINITION: "CUSTOM_FIELD_DEFINITION",
  CUSTOM_OBJECT_DEFINITION: "CUSTOM_OBJECT_DEFINITION",
  AUDIT_LOG: "AUDIT_LOG",
  JOB: "JOB",
  CANDIDATE: "CANDIDATE",
  APPLICATION: "APPLICATION",
  INTERVIEW: "INTERVIEW",
  OFFER: "OFFER",
  HANDOFF: "HANDOFF",
} as const;

export type EntityKey = (typeof ENTITY)[keyof typeof ENTITY];

/** Human-readable labels for the role permission matrix. */
export const ENTITY_LABELS: Record<string, string> = {
  [ENTITY.USER]: "Users",
  [ENTITY.ROLE]: "Roles & Permissions",
  [ENTITY.ORGANIZATION]: "Organization Settings",
  [ENTITY.CONTROLLED_LIST]: "Controlled Lists",
  [ENTITY.CUSTOM_FIELD_DEFINITION]: "Custom Fields",
  [ENTITY.CUSTOM_OBJECT_DEFINITION]: "Custom Objects",
  [ENTITY.AUDIT_LOG]: "Audit Log",
  [ENTITY.JOB]: "Jobs / Requisitions",
  [ENTITY.CANDIDATE]: "Candidates",
  [ENTITY.APPLICATION]: "Applications",
  [ENTITY.INTERVIEW]: "Interviews",
  [ENTITY.OFFER]: "Offers",
  [ENTITY.HANDOFF]: "Onboarding Handoffs",
};

/** Entities core modules may attach admin-defined custom fields to (§10.1). */
export const CUSTOM_FIELD_CAPABLE_ENTITIES: readonly string[] = [
  ENTITY.JOB,
  ENTITY.CANDIDATE,
  ENTITY.APPLICATION,
  ENTITY.INTERVIEW,
  ENTITY.OFFER,
  ENTITY.HANDOFF,
];

export function isKnownEntity(value: string): boolean {
  return (
    (Object.values(ENTITY) as string[]).includes(value) ||
    CUSTOM_FIELD_CAPABLE_ENTITIES.includes(value)
  );
}
