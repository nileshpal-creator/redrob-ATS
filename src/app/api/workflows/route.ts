import { withApiHandler } from "@/lib/api/handlers";
import { workflowDefinitionCreateSchema, workflowDefinitionQuerySchema } from "@/lib/validations/workflow";
import { createWorkflowDefinition, listWorkflowDefinitions } from "@/lib/services/workflow-definitions";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = workflowDefinitionQuerySchema.parse(params);
  return listWorkflowDefinitions(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = workflowDefinitionCreateSchema.parse(await request.json());
  return createWorkflowDefinition(context, input);
});
