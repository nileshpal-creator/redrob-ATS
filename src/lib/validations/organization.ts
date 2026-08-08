import { z } from "zod";

/**
 * §11.5: "configurable intervals" — minutes before Interview.scheduledAt.
 * Capped at 10 entries and 30 days out, a conservative bound rather than an
 * open-ended settings system; empty means no automatic reminders are sent.
 */
export const organizationSettingsUpdateSchema = z.object({
  interviewReminderLeadMinutes: z
    .array(z.number().int().positive().max(30 * 24 * 60))
    .max(10)
    .refine((values) => new Set(values).size === values.length, "Lead times must be unique."),
});
export type OrganizationSettingsUpdateInput = z.infer<typeof organizationSettingsUpdateSchema>;
