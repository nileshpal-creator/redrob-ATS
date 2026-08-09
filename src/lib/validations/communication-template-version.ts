import { z } from "zod";

// Free-text language tag (e.g. "en", "es", "fr-CA") — not validated against
// a fixed ISO list, same "loose, service-boundary-only" looseness Job's own
// customFields/experienceHistory shapes already accept.
const languageField = z.string().trim().min(2, "Language is required").max(10);

export const communicationTemplateVersionCreateSchema = z.object({
  language: languageField.default("en"),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(10000),
});
export type CommunicationTemplateVersionCreateInput = z.infer<typeof communicationTemplateVersionCreateSchema>;

export const communicationTemplateVersionDecideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  comments: z.string().trim().max(1000).optional(),
});
export type CommunicationTemplateVersionDecideInput = z.infer<typeof communicationTemplateVersionDecideSchema>;
