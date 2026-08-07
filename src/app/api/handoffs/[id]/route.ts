import { withApiHandler } from "@/lib/api/handlers";
import { getHandoff } from "@/lib/services/handoffs";

type RouteParams = { id: string };

// Read-only: no PATCH/DELETE. Every mutation goes through the dedicated
// retry/acknowledge action endpoints below, same "plain PATCH vs. dedicated
// action endpoint" split Offer draws for its own transitions.
export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getHandoff(context, params.id);
});
