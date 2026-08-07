import { withApiHandler } from "@/lib/api/handlers";
import { offerUpdateSchema } from "@/lib/validations/offer";
import { getOffer, updateOffer } from "@/lib/services/offers";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getOffer(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = offerUpdateSchema.parse(await request.json());
  return updateOffer(context, params.id, input);
});

// No DELETE route — same reasoning as /api/jobs/[id]: revoke via
// POST /api/offers/[id]/status is the only supported way to retire an
// offer, not a hard delete.
