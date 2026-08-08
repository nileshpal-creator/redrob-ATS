import { withApiHandler } from "@/lib/api/handlers";
import { jobPostingCreateSchema } from "@/lib/validations/job-posting";
import { createJobPosting, listJobPostings } from "@/lib/services/job-postings";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return listJobPostings(context, params.id);
});

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = jobPostingCreateSchema.parse(await request.json());
  return createJobPosting(context, params.id, input);
});
