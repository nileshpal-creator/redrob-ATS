import { z } from "zod";

import { withApiHandler } from "@/lib/api/handlers";
import { decideWorkflowTask } from "@/lib/services/workflow-tasks";

type RouteParams = { id: string };

const decideSchema = z.object({ outcome: z.enum(["APPROVED", "REJECTED"]) });

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = decideSchema.parse(await request.json());
  return decideWorkflowTask(context, params.id, input.outcome);
});
