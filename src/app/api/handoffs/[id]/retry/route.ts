import { withApiHandler } from "@/lib/api/handlers";
import { handoffRetrySchema } from "@/lib/validations/handoff";
import { retryHandoff } from "@/lib/services/handoffs";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = handoffRetrySchema.parse(await request.json());
  return retryHandoff(context, params.id, input);
});
