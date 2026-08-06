import { withApiHandler } from "@/lib/api/handlers";
import { getCandidateTimeline } from "@/lib/services/candidates";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getCandidateTimeline(context, params.id);
});
