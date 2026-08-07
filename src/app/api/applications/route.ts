import { withApiHandler } from "@/lib/api/handlers";
import { applicationCreateSchema, applicationQuerySchema } from "@/lib/validations/application";
import { createApplication, listApplications } from "@/lib/services/applications";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const query = applicationQuerySchema.parse(Object.fromEntries(searchParams));
  return listApplications(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = applicationCreateSchema.parse(await request.json());
  return createApplication(context, input);
});
