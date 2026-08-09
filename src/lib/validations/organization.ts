import { z } from "zod";

/**
 * §11.5: "configurable intervals" — minutes before Interview.scheduledAt.
 * Capped at 10 entries and 30 days out, a conservative bound rather than an
 * open-ended settings system; empty means no automatic reminders are sent.
 *
 * §11.6: "Step-level SLA/turnaround-time tracking, configurable per
 * organization" — offerTatThresholdDays, the org-wide default
 * getOfferTatComplianceReport falls back to when a report request doesn't
 * supply its own tatThresholdDays override.
 *
 * Both fields are optional and each settings screen (Interview Reminders /
 * Offer TAT) only ever sends the one it edits — updateOrganizationSettings
 * applies exactly the fields present, leaving the other untouched, the same
 * "PATCH touches only what's provided" convention every other partial
 * update in this codebase already follows. At least one must be present.
 */
export const organizationSettingsUpdateSchema = z
  .object({
    interviewReminderLeadMinutes: z
      .array(z.number().int().positive().max(30 * 24 * 60))
      .max(10)
      .refine((values) => new Set(values).size === values.length, "Lead times must be unique.")
      .optional(),
    offerTatThresholdDays: z.coerce.number().int().positive().max(90).optional(),
    // §13: "retention limits." null clears the setting (no automatic sweep);
    // omitted leaves it untouched, same "PATCH touches only what's
    // provided" convention as the other two settings.
    candidateRetentionDays: z.coerce.number().int().positive().max(3650).nullable().optional(),
  })
  .refine(
    (val) =>
      val.interviewReminderLeadMinutes !== undefined ||
      val.offerTatThresholdDays !== undefined ||
      val.candidateRetentionDays !== undefined,
    "At least one setting must be provided.",
  );
export type OrganizationSettingsUpdateInput = z.infer<typeof organizationSettingsUpdateSchema>;
