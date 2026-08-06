import { withApiHandler } from "@/lib/api/handlers";
import { updateUserStatusSchema } from "@/lib/validations/user";
import { updateUserStatus } from "@/lib/services/users";

type RouteParams = { id: string };

export const PUT = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = updateUserStatusSchema.parse(await request.json());
  return updateUserStatus(context, params.id, input);
});
