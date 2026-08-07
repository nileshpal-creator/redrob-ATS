import { z } from "zod";

const channelField = z.enum(["EMAIL", "SMS"]);

// No .default() on channel/isActive — the create form drives them via
// react-hook-form's `defaultValues`; a Zod default here would make the
// schema's input and output types diverge and break zodResolver's typing
// (the same reason customObjectDefinitionSchema takes a plain `isActive:
// z.boolean()` instead of a default).
export const communicationTemplateCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  // SMS is accepted by the schema (§11.10 reserves the enum value) but has
  // no send path yet — see src/lib/services/applications.ts.
  channel: channelField,
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(10000),
  isActive: z.boolean(),
});
export type CommunicationTemplateCreateInput = z.infer<typeof communicationTemplateCreateSchema>;

/**
 * `name` is not editable: the picker in the bulk-email dialog and any
 * historical ApplicationEmailLog display reference a template by name, and
 * silently renaming an in-use template would be confusing — same reasoning
 * PipelineStage's name-uniqueness-among-active-rows convention avoids.
 * Deactivating and creating a replacement is the supported "rename" path.
 */
export const communicationTemplateUpdateSchema = z.object({
  channel: channelField.optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  isActive: z.boolean().optional(),
});
export type CommunicationTemplateUpdateInput = z.infer<typeof communicationTemplateUpdateSchema>;

export const communicationTemplateQuerySchema = z.object({
  channel: channelField.optional(),
  // Not z.coerce.boolean() — that maps the *string* "false" to `true`
  // (Boolean("false") is truthy). Query params arrive as strings, so this
  // has to be an explicit "true"/"false" match.
  isActive: z
    .string()
    .transform((value) => value === "true")
    .optional(),
});
export type CommunicationTemplateQuery = z.infer<typeof communicationTemplateQuerySchema>;
