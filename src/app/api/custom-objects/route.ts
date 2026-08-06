import { withApiHandler } from "@/lib/api/handlers";
import { customObjectDefinitionSchema } from "@/lib/validations/custom-object";
import {
  createCustomObjectDefinition,
  listCustomObjectDefinitions,
} from "@/lib/services/custom-objects";

export const GET = withApiHandler(async (context) => {
  return listCustomObjectDefinitions(context);
});

export const POST = withApiHandler(async (context, request) => {
  const input = customObjectDefinitionSchema.parse(await request.json());
  return createCustomObjectDefinition(context, input);
});
