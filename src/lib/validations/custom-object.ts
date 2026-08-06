import { z } from "zod";

import { fieldKeyPattern } from "./custom-field";

export const customObjectDefinitionSchema = z.object({
  apiKey: z
    .string()
    .min(1, "API key is required")
    .max(64)
    .regex(fieldKeyPattern, "Use lowercase letters, numbers, and underscores, starting with a letter"),
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  isActive: z.boolean(),
});

export type CustomObjectDefinitionInput = z.infer<typeof customObjectDefinitionSchema>;

export const customObjectDefinitionUpdateSchema = customObjectDefinitionSchema
  .omit({ apiKey: true })
  .partial();

export type CustomObjectDefinitionUpdateInput = z.infer<
  typeof customObjectDefinitionUpdateSchema
>;
