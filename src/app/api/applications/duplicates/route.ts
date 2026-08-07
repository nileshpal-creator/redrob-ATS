import { withApiHandler } from "@/lib/api/handlers";
import { applicationDuplicateCheckSchema } from "@/lib/validations/application";
import { findDuplicateApplications } from "@/lib/services/applications";

export const GET = withApiHandler(async (context, request) => {
  const searchParams = new URL(request.url).searchParams;
  const input = applicationDuplicateCheckSchema.parse(Object.fromEntries(searchParams));
  return findDuplicateApplications(context, input);
});
