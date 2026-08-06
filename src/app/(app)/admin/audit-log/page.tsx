import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { listAuditLogs } from "@/lib/services/audit-log";
import { auditLogQuerySchema } from "@/lib/validations/audit-log";
import { AuditLogClient } from "@/components/admin/audit-log-client";

export default async function AuditLogPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.AUDIT_LOG, "READ");

  const result = await listAuditLogs(context, auditLogQuerySchema.parse({}));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          Every configuration change is recorded with who made it and when.
        </p>
      </div>
      <AuditLogClient initialResult={result} />
    </div>
  );
}
