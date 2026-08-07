import { withApiHandler } from "@/lib/api/handlers";
import { handoffQuerySchema } from "@/lib/validations/handoff";
import { listHandoffs } from "@/lib/services/handoffs";

// No POST route: a HandoffRecord is only ever created as a side effect of
// Offer's ACCEPT transition (src/lib/services/offers.ts), never through a
// dedicated endpoint — see resource-actions.ts's comment on ENTITY.HANDOFF.
export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = handoffQuerySchema.parse(params);
  return listHandoffs(context, query);
});
