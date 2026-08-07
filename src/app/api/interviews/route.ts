import { withApiHandler } from "@/lib/api/handlers";
import { interviewCreateSchema, interviewQuerySchema } from "@/lib/validations/interview";
import { listInterviews, scheduleInterview } from "@/lib/services/interviews";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const query = interviewQuerySchema.parse(Object.fromEntries(searchParams));
  return listInterviews(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = interviewCreateSchema.parse(await request.json());
  return scheduleInterview(context, input);
});
