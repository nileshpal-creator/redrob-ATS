import { withApiHandler } from "@/lib/api/handlers";
import { updateUserRolesSchema } from "@/lib/validations/user";
import { updateUserRoles } from "@/lib/services/users";

type RouteParams = { id: string };

export const PUT = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = updateUserRolesSchema.parse(await request.json());
  return updateUserRoles(context, params.id, input);
});
