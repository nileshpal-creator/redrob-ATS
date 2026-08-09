import { prisma } from "@/lib/prisma";
import { CUSTOM_FIELD_CAPABLE_ENTITIES, ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { ValidationError } from "@/lib/errors";
import { listJobs } from "@/lib/services/jobs";
import { listCandidates } from "@/lib/services/candidates";
import { listApplications } from "@/lib/services/applications";
import { listInterviews } from "@/lib/services/interviews";
import { listOffers } from "@/lib/services/offers";
import { listHandoffs } from "@/lib/services/handoffs";
import { listCustomObjectRecords } from "@/lib/services/custom-object-records";
import { jobQuerySchema } from "@/lib/validations/job";
import { candidateQuerySchema } from "@/lib/validations/candidate";
import { applicationQuerySchema } from "@/lib/validations/application";
import { interviewQuerySchema } from "@/lib/validations/interview";
import { offerQuerySchema } from "@/lib/validations/offer";
import { handoffQuerySchema } from "@/lib/validations/handoff";
import type { DashboardFilter } from "@/lib/validations/dashboard";

/**
 * §10.5: "over any entity, including custom objects and fields." Every
 * runner calls the exact same permission-checked, RBAC-scope-filtered,
 * field-permission-sanitized list function each entity's own module
 * already exposes — never a second, parallel query path — so a widget's
 * row-level *and* field-level security both fall out for free, recomputed
 * against the current viewer on every render, the same "never a row-set
 * frozen at save time" precedent SavedReport's own row-level-security note
 * already establishes.
 *
 * Capped at 100 rows per widget (`pageSize: 100`, each entity's own
 * documented max) — a known limitation, the same "at most 100" precedent
 * the per-job Pipeline page's own board/list view already accepts. A
 * widget summarizing a larger table will undercount; there is no
 * pagination-looping here.
 */
const CORE_ENTITY_RUNNERS: Record<
  string,
  (context: SessionContext) => Promise<Record<string, unknown>[]>
> = {
  [ENTITY.JOB]: async (context) => (await listJobs(context, jobQuerySchema.parse({ pageSize: 100 }))).jobs,
  [ENTITY.CANDIDATE]: async (context) =>
    (await listCandidates(context, candidateQuerySchema.parse({ pageSize: 100 }))).candidates,
  [ENTITY.APPLICATION]: async (context) =>
    (await listApplications(context, applicationQuerySchema.parse({ pageSize: 100 }))).applications,
  [ENTITY.INTERVIEW]: async (context) =>
    (await listInterviews(context, interviewQuerySchema.parse({ pageSize: 100 }))).interviews,
  [ENTITY.OFFER]: async (context) => (await listOffers(context, offerQuerySchema.parse({ pageSize: 100 }))).offers,
  [ENTITY.HANDOFF]: async (context) =>
    (await listHandoffs(context, handoffQuerySchema.parse({ pageSize: 100 }))).handoffs,
};

async function fetchWidgetRows(context: SessionContext, entityType: string): Promise<Record<string, unknown>[]> {
  const coreRunner = CORE_ENTITY_RUNNERS[entityType];
  if (coreRunner) {
    return coreRunner(context);
  }

  // Not a core entity — must be an active CustomObjectDefinition's own
  // apiKey (§10.1). Falls through to NotFoundError-shaped rejection below
  // if it matches neither, mirroring assertRelatedEntityExists's own
  // "unknown type" ValidationError in custom-object-records.ts.
  const definition = await prisma.customObjectDefinition.findUnique({ where: { apiKey: entityType } });
  if (!definition || !definition.isActive) {
    throw new ValidationError(`"${entityType}" is not a known entity or active custom object.`);
  }
  const { records } = await listCustomObjectRecords(context, {
    definitionId: definition.id,
    page: 1,
    pageSize: 100,
  });
  // Widgets read core fields and customFields.<key> through one flat
  // resolver (resolveFieldValue below) — flatten data.<key> into
  // customFields.<key> so a custom-object record's own fields address the
  // same way a core entity's customFields already do.
  return records.map((record) => ({ ...record, customFields: record.data }));
}

/** Every entityType a widget may target — used by the admin UI's entity picker. */
export async function listWidgetEntityOptions(context: SessionContext): Promise<{ value: string; label: string }[]> {
  await requirePermission(context, ENTITY.DASHBOARD, "CREATE");
  const coreOptions = CUSTOM_FIELD_CAPABLE_ENTITIES.map((entityType) => ({
    value: entityType,
    label: entityType,
  }));
  const customObjects = await prisma.customObjectDefinition.findMany({ where: { isActive: true } });
  return [...coreOptions, ...customObjects.map((definition) => ({ value: definition.apiKey, label: definition.name }))];
}

/** "customFields.<key>" addresses a custom field, same dot-path convention FieldPermission.field already uses. */
function resolveFieldValue(row: Record<string, unknown>, fieldKey: string): unknown {
  if (fieldKey.startsWith("customFields.")) {
    const key = fieldKey.slice("customFields.".length);
    const customFields = row.customFields;
    return customFields && typeof customFields === "object" ? (customFields as Record<string, unknown>)[key] : undefined;
  }
  return row[fieldKey];
}

function matchesFilter(row: Record<string, unknown>, filter: DashboardFilter): boolean {
  const actual = resolveFieldValue(row, filter.field);
  switch (filter.operator) {
    case "EQUALS":
      return actual !== undefined && actual !== null && String(actual) === String(filter.value);
    case "NOT_EQUALS":
      return !(actual !== undefined && actual !== null && String(actual) === String(filter.value));
    case "GREATER_THAN":
      return typeof actual === "number" && actual > Number(filter.value);
    case "LESS_THAN":
      return typeof actual === "number" && actual < Number(filter.value);
    case "CONTAINS":
      return typeof actual === "string" && actual.includes(String(filter.value));
    default:
      return false;
  }
}

/** AND-only, mirroring evaluateConditions in src/lib/services/workflows.ts. */
function applyFilters(rows: Record<string, unknown>[], filters: DashboardFilter[]): Record<string, unknown>[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function aggregate(rows: Record<string, unknown>[], widget: { aggregate: string; fieldKey?: string | null }): number {
  if (widget.aggregate === "COUNT") {
    return rows.length;
  }
  const values = rows.map((row) => (widget.fieldKey ? toNumber(resolveFieldValue(row, widget.fieldKey)) : null)).filter(
    (value): value is number => value !== null,
  );
  if (values.length === 0) return 0;
  switch (widget.aggregate) {
    case "SUM":
      return values.reduce((sum, value) => sum + value, 0);
    case "AVG":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "MIN":
      return Math.min(...values);
    case "MAX":
      return Math.max(...values);
    default:
      return 0;
  }
}

export type DashboardWidgetResult = {
  widgetId: string;
  title: string;
  aggregate: string;
  groupByKey: string | null;
  data: { group: string | null; value: number }[];
};

/**
 * Computes one widget's data against the *current* viewer's own RBAC scope
 * and field permissions — never cached, never computed as anyone but the
 * caller. Grouping resolves the group key's raw value to a string label; an
 * ungrouped widget returns a single `{ group: null, value }` row.
 */
export async function computeWidgetData(
  context: SessionContext,
  widget: {
    id: string;
    title: string;
    entityType: string;
    aggregate: string;
    fieldKey: string | null;
    groupByKey: string | null;
    filters: unknown;
  },
): Promise<DashboardWidgetResult> {
  const rows = applyFilters(await fetchWidgetRows(context, widget.entityType), (widget.filters as DashboardFilter[]) ?? []);

  if (!widget.groupByKey) {
    return {
      widgetId: widget.id,
      title: widget.title,
      aggregate: widget.aggregate,
      groupByKey: null,
      data: [{ group: null, value: aggregate(rows, widget) }],
    };
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const rawGroup = resolveFieldValue(row, widget.groupByKey);
    const label = rawGroup === undefined || rawGroup === null ? "(none)" : String(rawGroup);
    const bucket = groups.get(label) ?? [];
    bucket.push(row);
    groups.set(label, bucket);
  }

  return {
    widgetId: widget.id,
    title: widget.title,
    aggregate: widget.aggregate,
    groupByKey: widget.groupByKey,
    data: Array.from(groups.entries()).map(([group, groupRows]) => ({ group, value: aggregate(groupRows, widget) })),
  };
}
