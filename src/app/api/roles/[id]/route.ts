import { withApiHandler } from "@/lib/api/handlers";
import { roleUpdateSchema } from "@/lib/validations/role";
import { deleteRole, updateRole } from "@/lib/services/roles";

type RouteParams = { id: string };

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = roleUpdateSchema.parse(await request.json());
  return updateRole(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteRole(context, params.id);
});
