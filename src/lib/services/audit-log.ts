import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import type { AuditLogQuery } from "@/lib/validations/audit-log";

/** Searchable by user, entity, and date range — §11.13. */
export async function listAuditLogs(context: SessionContext, query: AuditLogQuery) {
  await requirePermission(context, ENTITY.AUDIT_LOG, "READ");

  const where = {
    actorId: query.actorId,
    entityType: query.entityType,
    entityId: query.entityId,
    createdAt:
      query.from || query.to
        ? { gte: query.from, lte: query.to }
        : undefined,
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { entries, total, page: query.page, pageSize: query.pageSize };
}
