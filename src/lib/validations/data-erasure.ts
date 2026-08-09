import { z } from "zod";

/**
 * §13: "GDPR-aligned consent capture and retention limits." A staff-
 * initiated request to erase one candidate's PII — see
 * src/lib/services/candidate-erasure.ts for how ANONYMIZE/HARD_DELETE are
 * carried out and why HARD_DELETE reuses deleteCandidate's own
 * block-if-applications-exist rule rather than bypassing it.
 */
export const dataErasureRequestCreateSchema = z.object({
  method: z.enum(["ANONYMIZE", "HARD_DELETE"]),
  reason: z.string().max(500).optional(),
});
export type DataErasureRequestCreateInput = z.infer<typeof dataErasureRequestCreateSchema>;

export const dataErasureRequestDecideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  decisionNotes: z.string().max(500).optional(),
});
export type DataErasureRequestDecideInput = z.infer<typeof dataErasureRequestDecideSchema>;

export const dataErasureRequestQuerySchema = z.object({
  status: z.enum(["PENDING", "COMPLETED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type DataErasureRequestQuery = z.infer<typeof dataErasureRequestQuerySchema>;
