import { withApiHandler } from "@/lib/api/handlers";
import { interviewFeedbackCreateSchema, interviewFeedbackUpdateSchema } from "@/lib/validations/interview";
import { submitInterviewFeedback, updateInterviewFeedback } from "@/lib/services/interviews";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = interviewFeedbackCreateSchema.parse(await request.json());
  return submitInterviewFeedback(context, params.id, input);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = interviewFeedbackUpdateSchema.parse(await request.json());
  return updateInterviewFeedback(context, params.id, input);
});
