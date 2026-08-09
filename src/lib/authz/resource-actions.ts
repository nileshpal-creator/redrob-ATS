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
  // APPROVE gates deciding a §13 data-erasure request (see
  // src/lib/services/candidate-erasure.ts) — always required at ALL scope
  // specifically for that decision, the same "org-wide compliance decision,
  // not a per-record one" shape ApprovalStepConfig's own configuration gate
  // already uses.
  [ENTITY.CANDIDATE]: ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE"],
  // No CREATE: a HandoffRecord is only ever created as a side effect of
  // Offer's ACCEPT transition, never through a dedicated endpoint. No
  // DELETE: same "no hard delete" precedent as every other lifecycle entity.
  [ENTITY.HANDOFF]: ["READ", "UPDATE", "APPROVE"],
  // No DELETE: a template is never hard-deleted once it may have been used
  // for a send (ApplicationEmailLog.templateId) — "removing" one deactivates
  // it instead, same convention as PipelineStage.
  // APPROVE gates deciding (approve/reject) and rolling back a
  // CommunicationTemplateVersion — see communication-template-versions.ts.
  [ENTITY.COMMUNICATION_TEMPLATE]: ["CREATE", "READ", "UPDATE", "APPROVE"],
  // No DELETE: a WorkflowTask holds a historical reference to whichever
  // WorkflowDefinitionVersion created it — "removing" a workflow deactivates
  // it instead, same convention as CommunicationTemplate/PipelineStage. No
  // APPROVE: approving/rejecting a WorkflowTask (the REQUEST_APPROVAL action)
  // is gated through APPLICATION:UPDATE, not a WORKFLOW_DEFINITION action —
  // see assertWorkflowTaskAccess in src/lib/services/workflows.ts.
  [ENTITY.WORKFLOW_DEFINITION]: ["CREATE", "READ", "UPDATE"],
};

export function getApplicableActions(resource: string): PermissionAction[] {
  return RESOURCE_ACTIONS[resource] ?? DEFAULT_ACTIONS;
}
