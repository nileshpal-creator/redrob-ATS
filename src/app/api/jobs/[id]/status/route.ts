import { withApiHandler } from "@/lib/api/handlers";
import { jobStatusActionSchema } from "@/lib/validations/job";
import { transitionJobStatus } from "@/lib/services/jobs";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = jobStatusActionSchema.parse(await request.json());
  return transitionJobStatus(context, params.id, input);
});
