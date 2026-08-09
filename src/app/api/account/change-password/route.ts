import { withApiHandler } from "@/lib/api/handlers";
import { changePasswordSchema } from "@/lib/validations/user";
import { changePassword } from "@/lib/services/users";

export const POST = withApiHandler(async (context, request) => {
  const input = changePasswordSchema.parse(await request.json());
  await changePassword(context, input);
});
