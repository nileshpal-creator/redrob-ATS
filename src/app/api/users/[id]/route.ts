import { withApiHandler } from "@/lib/api/handlers";
import { deleteUser } from "@/lib/services/users";

type RouteParams = { id: string };

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteUser(context, params.id);
});
