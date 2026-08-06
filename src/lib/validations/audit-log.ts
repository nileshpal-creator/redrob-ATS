import { z } from "zod";

export const auditLogQuerySchema = z.object({
  actorId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
