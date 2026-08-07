import { withApiHandler } from "@/lib/api/handlers";
import { interviewUpdateSchema } from "@/lib/validations/interview";
import { getInterview, updateInterview } from "@/lib/services/interviews";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getInterview(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = interviewUpdateSchema.parse(await request.json());
  return updateInterview(context, params.id, input);
});
