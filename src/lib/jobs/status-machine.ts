import type { JobStatus, PermissionAction } from "@/generated/prisma/enums";

/**
 * Single source of truth for the Job status lifecycle (§11.1: "configurable
 * approval workflow before a job opens for sourcing"). This is a
 * purpose-built, fixed table for v1 — the generic, admin-configurable
 * visual Workflow & Automation Builder (§10.2) is Module 8. Module 8 is
 * expected to read/extend this same shape rather than reimplement job
 * transitions from scratch, which is why this table is data (an array),
 * not a scattering of `if` statements.
 */
export const JOB_ACTIONS = [
  "SUBMIT",
  "APPROVE",
  "REJECT",
  "HOLD",
  "RESUME",
  "CLOSE",
  "CANCEL",
] as const;

export type JobAction = (typeof JOB_ACTIONS)[number];

export type JobTransition = {
  action: JobAction;
  from: JobStatus;
  to: JobStatus;
  /** Which PermissionAction the actor needs — APPROVE/REJECT need JOB:APPROVE, everything else needs JOB:UPDATE. */
  requiredAction: PermissionAction;
  reasonRequired: boolean;
  /** ControlledList key the reason must belong to, when reasonRequired is true. */
  reasonListKey?: string;
  /**
   * When true, ownership for this transition is checked against the job's
   * hiring manager only. Every other transition accepts either the primary
   * recruiter or the hiring manager as "the owner" — approval decisions are
   * specifically the hiring manager's call (§8 persona table).
   */
  approverOnly?: boolean;
};

export const JOB_TRANSITIONS: JobTransition[] = [
  { action: "SUBMIT", from: "DRAFT", to: "PENDING_APPROVAL", requiredAction: "UPDATE", reasonRequired: false },
  { action: "APPROVE", from: "PENDING_APPROVAL", to: "OPEN", requiredAction: "APPROVE", reasonRequired: false, approverOnly: true },
  { action: "REJECT", from: "PENDING_APPROVAL", to: "DRAFT", requiredAction: "APPROVE", reasonRequired: false, approverOnly: true },
  { action: "HOLD", from: "OPEN", to: "ON_HOLD", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_HOLD_REASON" },
  { action: "RESUME", from: "ON_HOLD", to: "OPEN", requiredAction: "UPDATE", reasonRequired: false },
  { action: "CLOSE", from: "OPEN", to: "CLOSED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_CLOSE_REASON" },
  { action: "CLOSE", from: "ON_HOLD", to: "CLOSED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_CLOSE_REASON" },
  { action: "CANCEL", from: "DRAFT", to: "CANCELLED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_CANCEL_REASON" },
  { action: "CANCEL", from: "PENDING_APPROVAL", to: "CANCELLED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_CANCEL_REASON" },
  { action: "CANCEL", from: "OPEN", to: "CANCELLED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_CANCEL_REASON" },
  { action: "CANCEL", from: "ON_HOLD", to: "CANCELLED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "JOB_CANCEL_REASON" },
];

export function findTransition(from: JobStatus, action: JobAction): JobTransition | undefined {
  return JOB_TRANSITIONS.find((transition) => transition.from === from && transition.action === action);
}

/** All actions legal from a given status — drives which buttons a UI shows. */
export function getLegalActions(from: JobStatus): JobTransition[] {
  return JOB_TRANSITIONS.filter((transition) => transition.from === from);
}
