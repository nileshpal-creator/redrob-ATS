import { withApiHandler } from "@/lib/api/handlers";
import { auditLogQuerySchema } from "@/lib/validations/audit-log";
import { listAuditLogs } from "@/lib/services/audit-log";

export const GET = withApiHandler(async (context, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = auditLogQuerySchema.parse(params);
  return listAuditLogs(context, query);
});
