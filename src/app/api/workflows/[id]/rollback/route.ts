import { withApiHandler } from "@/lib/api/handlers";
import { workflowRollbackSchema } from "@/lib/validations/workflow";
import { rollbackWorkflowDefinition } from "@/lib/services/workflow-definitions";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = workflowRollbackSchema.parse(await request.json());
  return rollbackWorkflowDefinition(context, params.id, input);
});
