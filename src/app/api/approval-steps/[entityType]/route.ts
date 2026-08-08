import { withApiHandler } from "@/lib/api/handlers";
import { ValidationError } from "@/lib/errors";
import { approvalEntityTypeSchema, approvalStepConfigsReplaceSchema } from "@/lib/validations/approval";
import { listApprovalStepConfigs, replaceApprovalStepConfigs } from "@/lib/services/approvals";

type RouteParams = { entityType: string };

function parseEntityType(value: string) {
  const result = approvalEntityTypeSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Unknown approval entity type "${value}".`);
  }
  return result.data;
}

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return listApprovalStepConfigs(context, parseEntityType(params.entityType));
});

export const PUT = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = approvalStepConfigsReplaceSchema.parse(await request.json());
  return replaceApprovalStepConfigs(context, parseEntityType(params.entityType), input);
});
