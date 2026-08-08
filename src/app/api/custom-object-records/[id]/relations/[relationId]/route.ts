import { withApiHandler } from "@/lib/api/handlers";
import { deleteCustomObjectRelation } from "@/lib/services/custom-object-records";

type RouteParams = { id: string; relationId: string };

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteCustomObjectRelation(context, params.relationId);
});
