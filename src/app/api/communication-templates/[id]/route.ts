import { withApiHandler } from "@/lib/api/handlers";
import { communicationTemplateUpdateSchema } from "@/lib/validations/communication-template";
import { updateCommunicationTemplate } from "@/lib/services/communication-templates";

type RouteParams = { id: string };

// No DELETE route — same reasoning as /api/jobs/[id]: deactivate via PATCH
// isActive, not a hard delete.
export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = communicationTemplateUpdateSchema.parse(await request.json());
  return updateCommunicationTemplate(context, params.id, input);
});
