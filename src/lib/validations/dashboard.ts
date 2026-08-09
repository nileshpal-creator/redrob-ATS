import { z } from "zod";

/**
 * §10.5: "Custom Dashboards & Reports... over any entity, including custom
 * objects and fields." `filters` is deliberately the exact same
 * `{ field, operator, value }` shape as WorkflowCondition
 * (src/lib/validations/workflow.ts) — AND-only, same reasoning as that
 * model's own comment — not a second filter DSL.
 */
const DASHBOARD_FILTER_OPERATORS = ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "CONTAINS"] as const;

export const dashboardFilterSchema = z.object({
  field: z.string().trim().min(1),
  operator: z.enum(DASHBOARD_FILTER_OPERATORS),
  value: z.union([z.string(), z.number()]),
});
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

export const dashboardCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
});
export type DashboardCreateInput = z.infer<typeof dashboardCreateSchema>;

export const dashboardUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  version: z.number().int().min(0),
});
export type DashboardUpdateInput = z.infer<typeof dashboardUpdateSchema>;

const dashboardAggregateSchema = z.enum(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/**
 * `entityType` is validated at the service boundary against
 * CUSTOM_FIELD_CAPABLE_ENTITIES + the live set of active CustomObjectDefinition
 * apiKeys (see resolveWidgetEntity in src/lib/reporting/dashboard-query.ts),
 * not here — same "plain string, checked once it's known which definition it
 * belongs to" shape custom-object-records.ts already uses for relatedEntityType.
 */
export const dashboardWidgetCreateSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(120),
    entityType: z.string().min(1, "Entity is required"),
    aggregate: dashboardAggregateSchema.default("COUNT"),
    fieldKey: z.string().min(1).optional(),
    groupByKey: z.string().min(1).optional(),
    filters: z.array(dashboardFilterSchema).max(10).default([]),
    sortOrder: z.number().int().min(0).default(0),
  })
  .refine((val) => val.aggregate === "COUNT" || val.fieldKey !== undefined, {
    message: "fieldKey is required for SUM/AVG/MIN/MAX widgets.",
    path: ["fieldKey"],
  });
export type DashboardWidgetCreateInput = z.infer<typeof dashboardWidgetCreateSchema>;

export const dashboardWidgetUpdateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  entityType: z.string().min(1).optional(),
  aggregate: dashboardAggregateSchema.optional(),
  fieldKey: z.string().min(1).nullable().optional(),
  groupByKey: z.string().min(1).nullable().optional(),
  filters: z.array(dashboardFilterSchema).max(10).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type DashboardWidgetUpdateInput = z.infer<typeof dashboardWidgetUpdateSchema>;
