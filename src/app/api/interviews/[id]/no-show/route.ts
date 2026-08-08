import { withApiHandler } from "@/lib/api/handlers";
import { interviewNoShowSchema } from "@/lib/validations/interview";
import { markInterviewNoShow } from "@/lib/services/interviews";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = interviewNoShowSchema.parse(await request.json());
  return markInterviewNoShow(context, params.id, input);
});
