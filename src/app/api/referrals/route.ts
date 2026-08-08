import { withApiHandler } from "@/lib/api/handlers";
import { referralCreateSchema } from "@/lib/validations/job-posting";
import { createReferral } from "@/lib/services/referrals";

export const POST = withApiHandler(async (context, request) => {
  const input = referralCreateSchema.parse(await request.json());
  return createReferral(context, input);
});
