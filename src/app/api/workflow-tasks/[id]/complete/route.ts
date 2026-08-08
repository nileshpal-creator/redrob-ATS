import { withApiHandler } from "@/lib/api/handlers";
import { completeWorkflowTask } from "@/lib/services/workflow-tasks";

type RouteParams = { id: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return completeWorkflowTask(context, params.id);
});
