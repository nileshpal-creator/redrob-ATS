import { z } from "zod";

// Same pattern as candidate.ts's own PHONE_PATTERN — duplicated rather than
// exported, matching this codebase's existing convention (assertControlledListValue
// is duplicated per-service-file rather than shared; see e.g. applications.ts,
// candidates.ts, jobs.ts).
const PHONE_PATTERN = /^[0-9+\-() ]{7,20}$/;

export const jobPostingCreateSchema = z.object({
  sourceId: z.string().min(1, "Board is required"),
});
export type JobPostingCreateInput = z.infer<typeof jobPostingCreateSchema>;

/**
 * The minimal signal an inbound application carries (§11.3: "Inbound
 * applications land directly in the correct pipeline with source tagged
 * automatically") — deliberately not the full candidateCreateSchema. A
 * board notification is a name/phone/email, not a full profile; the
 * candidate's fuller professional/education data is filled in later via the
 * normal candidate edit form, same as any other candidate record.
 */
export const inboundApplicationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().regex(PHONE_PATTERN, "Enter a valid phone number"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
  note: z.string().trim().max(2000).optional(),
});
export type InboundApplicationInput = z.infer<typeof inboundApplicationSchema>;

/**
 * "Refer a candidate" (§11.3: "Referral capture as a distinct source type")
 * — a candidate and an application for one specific job in a single step,
 * the same minimal-fields shape as inboundApplicationSchema for the same
 * reason: fast, low-friction entry, full profile filled in later.
 */
export const referralCreateSchema = z.object({
  jobId: z.string().min(1, "Job is required"),
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().regex(PHONE_PATTERN, "Enter a valid phone number"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
  note: z.string().trim().max(2000).optional(),
});
export type ReferralCreateInput = z.infer<typeof referralCreateSchema>;
