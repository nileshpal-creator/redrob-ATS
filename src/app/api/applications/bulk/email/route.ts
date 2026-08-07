import { withApiHandler } from "@/lib/api/handlers";
import { applicationBulkEmailSchema } from "@/lib/validations/application";
import { bulkEmailApplications } from "@/lib/services/applications";

export const POST = withApiHandler(async (context, request) => {
  const input = applicationBulkEmailSchema.parse(await request.json());
  return bulkEmailApplications(context, input);
});
