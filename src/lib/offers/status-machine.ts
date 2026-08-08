import type { OfferStatus, PermissionAction } from "@/generated/prisma/enums";

/**
 * Single source of truth for the Offer lifecycle (§11.6), the same
 * data-table-not-scattered-ifs shape as src/lib/jobs/status-machine.ts —
 * Offer's draft → submit → approve/reject → extend → accept/decline
 * sequence (plus revoke from anywhere non-terminal) is a true sequential
 * workflow like Job's, unlike Interview's independent schedule/cancel/
 * complete actions. Module 10 (Workflow & Automation Builder, §10.2)
 * is expected to read/extend this table the same way it would Job's.
 */
export const OFFER_ACTIONS = ["SUBMIT", "APPROVE", "REJECT", "EXTEND", "ACCEPT", "DECLINE", "REVOKE"] as const;

export type OfferAction = (typeof OFFER_ACTIONS)[number];

export type OfferTransition = {
  action: OfferAction;
  from: OfferStatus;
  to: OfferStatus;
  /** Which PermissionAction the actor needs — APPROVE/REJECT need OFFER:APPROVE, everything else needs OFFER:UPDATE. */
  requiredAction: PermissionAction;
  reasonRequired: boolean;
  /** ControlledList key the reason must belong to, when reasonRequired is true. */
  reasonListKey?: string;
};

// Ownership for every transition — APPROVE/REJECT included — resolves
// against Offer.createdById, mirroring Job's JOB_TRANSITIONS comment: a
// role that approves without having drafted the offer (Hiring Manager) is
// granted ALL/TEAM scope in prisma/seed.ts rather than a per-offer
// "approver" field.
export const OFFER_TRANSITIONS: OfferTransition[] = [
  { action: "SUBMIT", from: "DRAFT", to: "PENDING_APPROVAL", requiredAction: "UPDATE", reasonRequired: false },
  { action: "APPROVE", from: "PENDING_APPROVAL", to: "APPROVED", requiredAction: "APPROVE", reasonRequired: false },
  { action: "REJECT", from: "PENDING_APPROVAL", to: "DRAFT", requiredAction: "APPROVE", reasonRequired: false },
  { action: "EXTEND", from: "APPROVED", to: "EXTENDED", requiredAction: "UPDATE", reasonRequired: false },
  { action: "ACCEPT", from: "EXTENDED", to: "ACCEPTED", requiredAction: "UPDATE", reasonRequired: false },
  { action: "DECLINE", from: "EXTENDED", to: "DECLINED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "OFFER_OUTCOME_REASON" },
  { action: "REVOKE", from: "DRAFT", to: "REVOKED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "OFFER_OUTCOME_REASON" },
  { action: "REVOKE", from: "PENDING_APPROVAL", to: "REVOKED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "OFFER_OUTCOME_REASON" },
  { action: "REVOKE", from: "APPROVED", to: "REVOKED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "OFFER_OUTCOME_REASON" },
  { action: "REVOKE", from: "EXTENDED", to: "REVOKED", requiredAction: "UPDATE", reasonRequired: true, reasonListKey: "OFFER_OUTCOME_REASON" },
];

export function findTransition(from: OfferStatus, action: OfferAction): OfferTransition | undefined {
  return OFFER_TRANSITIONS.find((transition) => transition.from === from && transition.action === action);
}

/** All actions legal from a given status — drives which buttons a UI shows. */
export function getLegalActions(from: OfferStatus): OfferTransition[] {
  return OFFER_TRANSITIONS.filter((transition) => transition.from === from);
}
