import { z } from "zod";

const HANDOFF_STATUSES = ["PENDING", "DELIVERED", "ACCEPTED", "EXCEPTION"] as const;

export const handoffRetrySchema = z.object({
  version: z.number().int(),
});
export type HandoffRetryInput = z.infer<typeof handoffRetrySchema>;

/**
 * HR/Onboarding's acknowledgement decision — mirrors offerTransitionSchema's
 * reason-required-on-certain-outcomes pattern. exceptionReason is free-form
 * (what went wrong receiving the package) rather than a Controlled List
 * reason, since there's no existing "handoff exception reason" list and
 * inventing a controlled vocabulary for a single free-text field would be
 * exactly the "unnecessary abstraction" the brief warns against.
 */
export const handoffAcknowledgeSchema = z
  .object({
    version: z.number().int(),
    outcome: z.enum(["ACCEPTED", "EXCEPTION"]),
    exceptionReason: z.string().trim().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.outcome === "EXCEPTION" && !val.exceptionReason) {
      ctx.addIssue({
        code: "custom",
        path: ["exceptionReason"],
        message: "A reason is required when reporting an exception",
      });
    }
  });
export type HandoffAcknowledgeInput = z.infer<typeof handoffAcknowledgeSchema>;

export const handoffQuerySchema = z.object({
  applicationId: z.string().optional(),
  status: z.enum(HANDOFF_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type HandoffQuery = z.infer<typeof handoffQuerySchema>;
