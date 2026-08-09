import { withApiHandler } from "@/lib/api/handlers";
import { communicationTemplateVersionDecideSchema } from "@/lib/validations/communication-template-version";
import { decideCommunicationTemplateVersion } from "@/lib/services/communication-template-versions";

type RouteParams = { id: string; versionId: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = communicationTemplateVersionDecideSchema.parse(await request.json());
  return decideCommunicationTemplateVersion(context, params.id, params.versionId, input);
});
