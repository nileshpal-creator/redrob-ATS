import { withApiHandler } from "@/lib/api/handlers";
import { rollbackCommunicationTemplateVersion } from "@/lib/services/communication-template-versions";

type RouteParams = { id: string; versionId: string };

export const POST = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return rollbackCommunicationTemplateVersion(context, params.id, params.versionId);
});
