import { withApiHandler } from "@/lib/api/handlers";
import { applicationUpdateSchema } from "@/lib/validations/application";
import { getApplication, updateApplication } from "@/lib/services/applications";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getApplication(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = applicationUpdateSchema.parse(await request.json());
  return updateApplication(context, params.id, input);
});
