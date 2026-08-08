import { withApiHandler } from "@/lib/api/handlers";
import { workflowDefinitionUpdateSchema } from "@/lib/validations/workflow";
import { getWorkflowDefinition, updateWorkflowDefinition } from "@/lib/services/workflow-definitions";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getWorkflowDefinition(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = workflowDefinitionUpdateSchema.parse(await request.json());
  return updateWorkflowDefinition(context, params.id, input);
});
