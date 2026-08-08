import { withApiHandler } from "@/lib/api/handlers";
import { inboundApplicationSchema } from "@/lib/validations/job-posting";
import { receiveInboundApplication } from "@/lib/services/job-postings";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = inboundApplicationSchema.parse(await request.json());
  return receiveInboundApplication(context, params.id, input);
});
