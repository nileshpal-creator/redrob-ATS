import { withApiHandler } from "@/lib/api/handlers";
import { customFieldDefinitionUpdateSchema } from "@/lib/validations/custom-field";
import {
  deleteCustomFieldDefinition,
  updateCustomFieldDefinition,
} from "@/lib/services/custom-fields";

type RouteParams = { id: string };

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = customFieldDefinitionUpdateSchema.parse(await request.json());
  return updateCustomFieldDefinition(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteCustomFieldDefinition(context, params.id);
});
