import { withApiHandler } from "@/lib/api/handlers";
import { offerTransitionSchema } from "@/lib/validations/offer";
import { transitionOffer } from "@/lib/services/offers";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = offerTransitionSchema.parse(await request.json());
  return transitionOffer(context, params.id, input);
});
