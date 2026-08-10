import { withApiHandler } from "@/lib/api/handlers";
import { completeOnboarding } from "@/lib/services/users";

export const POST = withApiHandler(async (context) => {
  await completeOnboarding(context);
});
