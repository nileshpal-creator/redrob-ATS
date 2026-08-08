import { withApiHandler } from "@/lib/api/handlers";
import { customObjectRelationCreateSchema } from "@/lib/validations/custom-object";
import { createCustomObjectRelation, listCustomObjectRelations } from "@/lib/services/custom-object-records";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return listCustomObjectRelations(context, params.id);
});

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = customObjectRelationCreateSchema.parse({ ...(await request.json()), recordId: params.id });
  return createCustomObjectRelation(context, input);
});
