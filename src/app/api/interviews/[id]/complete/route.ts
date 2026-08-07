import { withApiHandler } from "@/lib/api/handlers";
import { interviewCompleteSchema } from "@/lib/validations/interview";
import { completeInterview } from "@/lib/services/interviews";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = interviewCompleteSchema.parse(await request.json());
  return completeInterview(context, params.id, input);
});
