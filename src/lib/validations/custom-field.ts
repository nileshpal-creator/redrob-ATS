import { z } from "zod";

const dropdownOptionsSchema = z.object({
  choices: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .min(1, "Add at least one option"),
});

const lookupOptionsSchema = z.object({
  targetEntityType: z.string().min(1),
});

// `options` shape depends on `fieldType`; validated together via
// `withOptionsRefinement` below rather than a discriminated union, since
// fieldType and options arrive as sibling form fields.
const optionsSchema = z.union([dropdownOptionsSchema, lookupOptionsSchema, z.object({})]);

export const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;

const customFieldDefinitionObjectSchema = z.object({
  entityType: z.string().min(1, "Entity is required"),
  key: z
    .string()
    .min(1, "Key is required")
    .max(64)
    .regex(
      fieldKeyPattern,
      "Use lowercase letters, numbers, and underscores, starting with a letter",
    ),
  label: z.string().min(1, "Label is required").max(120),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "DROPDOWN", "MULTI_SELECT", "LOOKUP"]),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  options: optionsSchema.optional(),
  defaultValue: z.unknown().optional(),
});

function withOptionsRefinement<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const fieldType = (value as { fieldType?: string }).fieldType;
    const options = (value as { options?: unknown }).options;

    if (fieldType && ["DROPDOWN", "MULTI_SELECT"].includes(fieldType)) {
      if (!dropdownOptionsSchema.safeParse(options).success) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "Dropdown and multi-select fields need at least one choice",
        });
      }
    }

    if (fieldType === "LOOKUP" && !lookupOptionsSchema.safeParse(options).success) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Lookup fields need a target entity",
      });
    }
  });
}

export const customFieldDefinitionSchema = withOptionsRefinement(
  customFieldDefinitionObjectSchema,
);
export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionSchema>;

export const customFieldDefinitionUpdateSchema = withOptionsRefinement(
  customFieldDefinitionObjectSchema.partial({
    entityType: true,
    key: true,
    fieldType: true,
  }),
);
export type CustomFieldDefinitionUpdateInput = z.infer<
  typeof customFieldDefinitionUpdateSchema
>;
