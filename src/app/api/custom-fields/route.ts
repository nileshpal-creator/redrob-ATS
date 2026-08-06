import { withApiHandler } from "@/lib/api/handlers";
import { customFieldDefinitionSchema } from "@/lib/validations/custom-field";
import {
  createCustomFieldDefinition,
  listCustomFieldDefinitions,
} from "@/lib/services/custom-fields";

export const GET = withApiHandler(async (context, request) => {
  const entityType = new URL(request.url).searchParams.get("entityType") ?? undefined;
  return listCustomFieldDefinitions(context, entityType);
});

export const POST = withApiHandler(async (context, request) => {
  const input = customFieldDefinitionSchema.parse(await request.json());
  return createCustomFieldDefinition(context, input);
});
