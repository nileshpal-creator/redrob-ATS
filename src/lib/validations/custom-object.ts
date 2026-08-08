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

/**
 * §10.1: records against an admin-defined Custom Object. `data` is
 * validated at the service layer against that object's own active
 * CustomFieldDefinition rows (entityType = the definition's apiKey) via
 * buildCustomFieldValueSchema — the same dynamic-shape validation every
 * core entity's `customFields` blob already goes through. Shape-only here:
 * an empty/missing key isn't rejected until the service resolves which
 * definition it belongs to.
 */
export const customObjectRecordCreateSchema = z.object({
  definitionId: z.string().min(1, "Custom object definition is required"),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type CustomObjectRecordCreateInput = z.infer<typeof customObjectRecordCreateSchema>;

// A full replace of `data`, not a partial merge — mirrors how every core
// entity's own customFields update already works (see updateJob): the
// caller resends the complete value set, validated against every
// currently-active field definition, not just the keys being changed.
export const customObjectRecordUpdateSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
export type CustomObjectRecordUpdateInput = z.infer<typeof customObjectRecordUpdateSchema>;

export const customObjectRecordQuerySchema = z.object({
  definitionId: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomObjectRecordQuery = z.infer<typeof customObjectRecordQuerySchema>;

/**
 * §10.1: links a record to a core entity (Job/Candidate/Application/
 * Interview/Offer/Handoff) — see the CustomObjectRelation model's own
 * schema.prisma comment. relatedEntityType/relatedEntityId existence is
 * checked at the service layer (see assertRelatedEntityExists in
 * src/lib/services/custom-object-records.ts), not here — this only
 * validates shape.
 */
export const customObjectRelationCreateSchema = z.object({
  recordId: z.string().min(1, "Record is required"),
  relatedEntityType: z.string().min(1, "Related entity type is required"),
  relatedEntityId: z.string().min(1, "Related entity id is required"),
});
export type CustomObjectRelationCreateInput = z.infer<typeof customObjectRelationCreateSchema>;
