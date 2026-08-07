import { z } from "zod";

import { OFFER_ACTIONS } from "@/lib/offers/status-machine";

const OFFER_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXTENDED",
  "ACCEPTED",
  "DECLINED",
  "REVOKED",
] as const;

const notesField = z.string().trim().max(2000).optional();

export const offerCreateSchema = z.object({
  applicationId: z.string().min(1, "Application is required"),
  compensation: z.number().positive("Compensation must be greater than 0"),
  expectedJoiningDate: z.coerce.date().optional(),
  notes: notesField,
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type OfferCreateInput = z.infer<typeof offerCreateSchema>;

/**
 * Edits are only accepted while an Offer is DRAFT (enforced at the service
 * layer, same "shape vs. business rule" split as everywhere else) — once
 * submitted, terms change through revoke-and-reissue, not a silent edit.
 * status/outcomeReasonId are not accepted here: every status change goes
 * through the transition endpoint below, mirroring interviewUpdateSchema's
 * exclusion of status/cancellationReasonId.
 */
export const offerUpdateSchema = z.object({
  version: z.number().int(),
  compensation: z.number().positive().optional(),
  expectedJoiningDate: z.coerce.date().optional().nullable(),
  notes: notesField.nullable(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>;

export const offerTransitionSchema = z
  .object({
    action: z.enum(OFFER_ACTIONS),
    version: z.number().int(),
    reasonId: z.string().optional(),
    // Approver's decision note on APPROVE/REJECT, recorded on the
    // OfferApproval row — not a reason from a Controlled List, since it's
    // free-form context from the approver rather than a fixed vocabulary.
    comments: z.string().trim().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (["DECLINE", "REVOKE"].includes(val.action) && !val.reasonId) {
      ctx.addIssue({ code: "custom", path: ["reasonId"], message: "A reason is required for this transition" });
    }
  });
export type OfferTransitionInput = z.infer<typeof offerTransitionSchema>;

export const offerQuerySchema = z.object({
  applicationId: z.string().optional(),
  status: z.enum(OFFER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type OfferQuery = z.infer<typeof offerQuerySchema>;
