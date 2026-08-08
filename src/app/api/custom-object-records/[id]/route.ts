import { withApiHandler } from "@/lib/api/handlers";
import { customObjectRecordUpdateSchema } from "@/lib/validations/custom-object";
import {
  deleteCustomObjectRecord,
  getCustomObjectRecord,
  updateCustomObjectRecord,
} from "@/lib/services/custom-object-records";

type RouteParams = { id: string };

export const GET = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  return getCustomObjectRecord(context, params.id);
});

export const PATCH = withApiHandler<unknown, RouteParams>(async (context, request, params) => {
  const input = customObjectRecordUpdateSchema.parse(await request.json());
  return updateCustomObjectRecord(context, params.id, input);
});

export const DELETE = withApiHandler<unknown, RouteParams>(async (context, _request, params) => {
  await deleteCustomObjectRecord(context, params.id);
});
