import { withApiHandler } from "@/lib/api/handlers";
import { offerCreateSchema, offerQuerySchema } from "@/lib/validations/offer";
import { createOffer, listOffers } from "@/lib/services/offers";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = offerQuerySchema.parse(params);
  return listOffers(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = offerCreateSchema.parse(await request.json());
  return createOffer(context, input);
});
