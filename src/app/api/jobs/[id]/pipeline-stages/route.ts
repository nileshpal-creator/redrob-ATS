import { withApiHandler } from "@/lib/api/handlers";
import { pipelineStagesReplaceSchema } from "@/lib/validations/application";
import { getPipelineStages, replacePipelineStages } from "@/lib/services/pipeline-stages";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getPipelineStages(context, params.id);
});

export const PUT = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = pipelineStagesReplaceSchema.parse(await request.json());
  return replacePipelineStages(context, params.id, input);
});
