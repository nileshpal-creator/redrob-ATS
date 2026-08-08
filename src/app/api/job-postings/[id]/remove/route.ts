import { withApiHandler } from "@/lib/api/handlers";
import { removeJobPosting } from "@/lib/services/job-postings";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return removeJobPosting(context, params.id);
});
