import { withApiHandler } from "@/lib/api/handlers";
import { listWidgetEntityOptions } from "@/lib/reporting/dashboard-query";

export const GET = withApiHandler(async (context) => {
  return listWidgetEntityOptions(context);
});
