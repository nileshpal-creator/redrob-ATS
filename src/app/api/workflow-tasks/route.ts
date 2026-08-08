import { withApiHandler } from "@/lib/api/handlers";
import { workflowTaskQuerySchema } from "@/lib/validations/workflow";
import { listWorkflowTasks } from "@/lib/services/workflow-tasks";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = workflowTaskQuerySchema.parse(params);
  return listWorkflowTasks(context, query);
});
