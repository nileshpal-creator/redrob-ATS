import { withApiHandler } from "@/lib/api/handlers";
import { jobCreateSchema, jobQuerySchema } from "@/lib/validations/job";
import { createJob, listJobs } from "@/lib/services/jobs";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = jobQuerySchema.parse(params);
  return listJobs(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = jobCreateSchema.parse(await request.json());
  return createJob(context, input);
});
