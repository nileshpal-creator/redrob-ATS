import { withApiHandler } from "@/lib/api/handlers";
import { customObjectRecordCreateSchema, customObjectRecordQuerySchema } from "@/lib/validations/custom-object";
import { createCustomObjectRecord, listCustomObjectRecords } from "@/lib/services/custom-object-records";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = customObjectRecordQuerySchema.parse(params);
  return listCustomObjectRecords(context, query);
});

export const POST = withApiHandler(async (context, request) => {
  const input = customObjectRecordCreateSchema.parse(await request.json());
  return createCustomObjectRecord(context, input);
});
