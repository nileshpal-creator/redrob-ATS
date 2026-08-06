import { withApiHandler } from "@/lib/api/handlers";
import { roleSchema } from "@/lib/validations/role";
import { createRole, listRoles } from "@/lib/services/roles";

export const GET = withApiHandler(async (context) => {
  return listRoles(context);
});

export const POST = withApiHandler(async (context, request) => {
  const input = roleSchema.parse(await request.json());
  return createRole(context, input);
});
