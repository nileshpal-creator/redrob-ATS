import { z } from "zod";

import type { CustomFieldDefinition } from "@/generated/prisma/client";

type DropdownOptions = { choices: { value: string; label: string }[] };

/**
 * Builds a Zod schema for the `customFields` JSON blob on a core entity
 * (Job, Candidate, Application, Offer, ...) from its admin-defined
 * CustomFieldDefinition rows. This is what lets §10.1 ("add custom fields
 * without engineering involvement") actually hold at the API boundary —
 * every module's create/update route validates `customFields` by calling
 * this against that entity's active definitions, instead of trusting
 * whatever JSON the client sends.
 */
export function buildCustomFieldValueSchema(definitions: CustomFieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const definition of definitions) {
    if (!definition.isActive) {
      continue;
    }

    let fieldSchema: z.ZodTypeAny;

    switch (definition.fieldType) {
      case "TEXT":
        fieldSchema = z.string();
        break;
      case "NUMBER":
        fieldSchema = z.number();
        break;
      case "DATE":
        fieldSchema = z.coerce.date();
        break;
      case "DROPDOWN": {
        const options = definition.options as DropdownOptions | null;
        const values = options?.choices.map((choice) => choice.value) ?? [];
        fieldSchema = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
        break;
      }
      case "MULTI_SELECT": {
        const options = definition.options as DropdownOptions | null;
        const values = options?.choices.map((choice) => choice.value) ?? [];
        fieldSchema = z.array(
          values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string(),
        );
        break;
      }
      case "LOOKUP":
        fieldSchema = z.string();
        break;
      default:
        fieldSchema = z.unknown();
    }

    shape[definition.key] = definition.isRequired ? fieldSchema : fieldSchema.optional().nullable();
  }

  return z.object(shape);
}
