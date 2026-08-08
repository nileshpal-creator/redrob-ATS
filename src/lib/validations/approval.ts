import { z } from "zod";

/**
 * §11.1/§11.6: configurable, ordered approval chains shared by Job and
 * Offer — see the ApprovalStepConfig model comment in schema.prisma for
 * the full design rationale (why one shared config table, why steps are
 * snapshotted onto JobApproval/OfferApproval at submit time, why this is
 * a full-set replace rather than a per-step edit endpoint).
 */
export const approvalEntityTypeSchema = z.enum(["JOB", "OFFER"]);
export type ApprovalEntityTypeInput = z.infer<typeof approvalEntityTypeSchema>;

const approvalStepInputSchema = z.object({
  stepOrder: z.number().int().positive(),
  name: z.string().trim().min(1, "Step name is required").max(200),
  requiredRoleId: z.string().min(1, "A required role is required"),
});

export const approvalStepConfigsReplaceSchema = z.object({
  // Capped at 10 — a conservative bound on chain length, not a PRD-named
  // limit; an empty array means "no configured chain," which is the
  // existing single-step behavior (see buildApprovalStepSnapshots).
  steps: z
    .array(approvalStepInputSchema)
    .max(10)
    .refine((steps) => new Set(steps.map((step) => step.stepOrder)).size === steps.length, "stepOrder values must be unique")
    .refine((steps) => {
      const orders = steps.map((step) => step.stepOrder).sort((a, b) => a - b);
      return orders.every((order, index) => order === index + 1);
    }, "stepOrder must be a contiguous sequence starting at 1, with no gaps"),
});
export type ApprovalStepConfigsReplaceInput = z.infer<typeof approvalStepConfigsReplaceSchema>;
