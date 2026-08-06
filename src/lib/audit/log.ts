import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

type AuditEntry = {
  actorId: string | null;
  /** Namespaced action string, e.g. "role.created" — see actions.ts for the registry. */
  action: string;
  entityType: string;
  entityId: string;
  /** `{ before, after }` snapshot of only the fields that changed. */
  changes?: Record<string, unknown>;
};

export async function recordAudit(entry: AuditEntry) {
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      changes: (entry.changes as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
