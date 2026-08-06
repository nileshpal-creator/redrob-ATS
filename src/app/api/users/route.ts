import { withApiHandler } from "@/lib/api/handlers";
import { createUserSchema } from "@/lib/validations/user";
import { createUser, listUsers } from "@/lib/services/users";

export const GET = withApiHandler(async (context) => {
  return listUsers(context);
});

export const POST = withApiHandler(async (context, request) => {
  const input = createUserSchema.parse(await request.json());
  return createUser(context, input);
});
