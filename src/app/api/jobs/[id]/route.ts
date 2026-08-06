import { withApiHandler } from "@/lib/api/handlers";
import { jobUpdateSchema } from "@/lib/validations/job";
import { getJobById, updateJob } from "@/lib/services/jobs";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getJobById(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = jobUpdateSchema.parse(await request.json());
  return updateJob(context, params.id, input);
});

// No DELETE route: Module 2 removes hard delete from normal workflows.
// Cancellation/archival via POST /api/jobs/[id]/status is the only supported
// way to retire a job. If exceptional cleanup is ever genuinely required,
// that is a narrowly-scoped admin maintenance tool to add deliberately —
// not a route that exists "just in case."
