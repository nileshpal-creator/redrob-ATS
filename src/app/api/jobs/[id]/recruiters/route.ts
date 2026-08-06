import { withApiHandler } from "@/lib/api/handlers";
import { jobRecruitersUpdateSchema } from "@/lib/validations/job";
import { updateJobRecruiters } from "@/lib/services/jobs";

type RouteParams = { id: string };

export const PUT = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = jobRecruitersUpdateSchema.parse(await request.json());
  return updateJobRecruiters(context, params.id, input);
});
