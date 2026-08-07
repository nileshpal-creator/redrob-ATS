import { withApiHandler } from "@/lib/api/handlers";
import { handoffAcknowledgeSchema } from "@/lib/validations/handoff";
import { acknowledgeHandoff } from "@/lib/services/handoffs";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = handoffAcknowledgeSchema.parse(await request.json());
  return acknowledgeHandoff(context, params.id, input);
});
