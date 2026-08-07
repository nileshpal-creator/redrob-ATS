import { withApiHandler } from "@/lib/api/handlers";
import { interviewCancelSchema } from "@/lib/validations/interview";
import { cancelInterview } from "@/lib/services/interviews";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = interviewCancelSchema.parse(await request.json());
  return cancelInterview(context, params.id, input);
});
