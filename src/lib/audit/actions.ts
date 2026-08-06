/**
 * Registry of audit action strings. `AuditLog.action` is a free-form string
 * (see prisma/schema.prisma), so this file — not a DB enum — is the source
 * of truth for what actions exist. Each module appends its own `<entity>.*`
 * block here as it ships.
 */
export const AUDIT_ACTIONS = {
  ROLE_CREATED: "role.created",
  ROLE_UPDATED: "role.updated",
  ROLE_DELETED: "role.deleted",
  ROLE_PERMISSIONS_UPDATED: "role.permissions_updated",
  USER_CREATED: "user.created",
  USER_ROLES_UPDATED: "user.roles_updated",
  USER_STATUS_CHANGED: "user.status_changed",
  CUSTOM_FIELD_CREATED: "custom_field.created",
  CUSTOM_FIELD_UPDATED: "custom_field.updated",
  CUSTOM_FIELD_DELETED: "custom_field.deleted",
  CUSTOM_OBJECT_CREATED: "custom_object.created",
  CUSTOM_OBJECT_UPDATED: "custom_object.updated",
  CUSTOM_OBJECT_DELETED: "custom_object.deleted",
  CONTROLLED_LIST_VALUE_CREATED: "controlled_list_value.created",
  CONTROLLED_LIST_VALUE_UPDATED: "controlled_list_value.updated",
  CONTROLLED_LIST_VALUE_DELETED: "controlled_list_value.deleted",
  JOB_CREATED: "job.created",
  JOB_UPDATED: "job.updated",
  JOB_STATUS_CHANGED: "job.status_changed",
  JOB_RECRUITERS_UPDATED: "job.recruiters_updated",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
