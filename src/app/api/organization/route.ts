import { withApiHandler } from "@/lib/api/handlers";
import { organizationSettingsUpdateSchema } from "@/lib/validations/organization";
import { getOrganizationSettings, updateOrganizationSettings } from "@/lib/services/organization";

export const GET = withApiHandler(async (context) => {
  return getOrganizationSettings(context);
});

export const PATCH = withApiHandler(async (context, request) => {
  const input = organizationSettingsUpdateSchema.parse(await request.json());
  return updateOrganizationSettings(context, input);
});
