import { withApiHandler } from "@/lib/api/handlers";
import { applicationTransitionSchema } from "@/lib/validations/application";
import { transitionApplication } from "@/lib/services/applications";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = applicationTransitionSchema.parse(await request.json());
  return transitionApplication(context, params.id, input);
});
