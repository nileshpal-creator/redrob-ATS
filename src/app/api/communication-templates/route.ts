import { withApiHandler } from "@/lib/api/handlers";
import { communicationTemplateCreateSchema, communicationTemplateQuerySchema } from "@/lib/validations/communication-template";
import { createCommunicationTemplate, listCommunicationTemplates } from "@/lib/services/communication-templates";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = communicationTemplateQuerySchema.parse(params);
  return listCommunicationTemplates(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = communicationTemplateCreateSchema.parse(await request.json());
  return createCommunicationTemplate(context, input);
});
