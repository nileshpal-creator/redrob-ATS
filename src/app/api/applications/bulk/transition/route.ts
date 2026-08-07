import { withApiHandler } from "@/lib/api/handlers";
import { applicationBulkTransitionSchema } from "@/lib/validations/application";
import { bulkTransitionApplications } from "@/lib/services/applications";

export const POST = withApiHandler(async (context, request) => {
  const input = applicationBulkTransitionSchema.parse(await request.json());
  return bulkTransitionApplications(context, input);
});
