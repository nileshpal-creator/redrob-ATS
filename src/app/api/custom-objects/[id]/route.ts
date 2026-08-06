import { withApiHandler } from "@/lib/api/handlers";
import { customObjectDefinitionUpdateSchema } from "@/lib/validations/custom-object";
import {
  deleteCustomObjectDefinition,
  updateCustomObjectDefinition,
} from "@/lib/services/custom-objects";

type RouteParams = { id: string };

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = customObjectDefinitionUpdateSchema.parse(await request.json());
  return updateCustomObjectDefinition(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteCustomObjectDefinition(context, params.id);
});
