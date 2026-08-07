import type { PermissionAction } from "@/generated/prisma/enums";
import { ENTITY } from "@/lib/entity-registry";

const DEFAULT_ACTIONS: PermissionAction[] = ["CREATE", "READ", "UPDATE", "DELETE"];

/**
 * Which PermissionAction values make sense for a given resource. Most
 * resources are plain CRUD; a resource with a lifecycle concept (Job's
 * approval step) adds to that set instead of overloading UPDATE — see
 * Module 2's design notes. Consumed by the role permission matrix UI so it
 * doesn't offer an "Approve Users" checkbox, and available to any future
 * service that wants to validate a grant is even meaningful.
 */
const RESOURCE_ACTIONS: Partial<Record<string, PermissionAction[]>> = {
  [ENTITY.JOB]: ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE"],
  [ENTITY.OFFER]: ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE"],
};

export function getApplicableActions(resource: string): PermissionAction[] {
  return RESOURCE_ACTIONS[resource] ?? DEFAULT_ACTIONS;
}
