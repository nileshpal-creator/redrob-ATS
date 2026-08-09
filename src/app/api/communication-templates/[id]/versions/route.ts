import { withApiHandler } from "@/lib/api/handlers";
import { communicationTemplateVersionCreateSchema } from "@/lib/validations/communication-template-version";
import { createCommunicationTemplateVersion, listCommunicationTemplateVersions } from "@/lib/services/communication-template-versions";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return listCommunicationTemplateVersions(context, params.id);
});

export const POST = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = communicationTemplateVersionCreateSchema.parse(await request.json());
  return createCommunicationTemplateVersion(context, params.id, input);
});
