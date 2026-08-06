import { withApiHandler } from "@/lib/api/handlers";
import { rolePermissionsUpdateSchema } from "@/lib/validations/role";
import { replaceRolePermissions } from "@/lib/services/roles";

type RouteParams = { id: string };

export const PUT = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = rolePermissionsUpdateSchema.parse(await request.json());
  return replaceRolePermissions(context, params.id, input);
});
