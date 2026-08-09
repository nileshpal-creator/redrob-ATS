"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = init.method === "DELETE" && response.status === 200 ? await response.json().catch(() => null) : await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? "Request failed");
  }
  return body;
}

const AGGREGATES = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;
const OPERATORS = ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "CONTAINS"] as const;

type DashboardMeta = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  createdBy: { name: string };
  createdAt: string;
};

type WidgetFilter = { field: string; operator: (typeof OPERATORS)[number]; value: string | number };

type WidgetDef = {
  id: string;
  title: string;
  entityType: string;
  aggregate: (typeof AGGREGATES)[number];
  fieldKey: string | null;
  groupByKey: string | null;
  filters: WidgetFilter[];
  sortOrder: number;
};

type WidgetResult = {
  widgetId: string;
  title: string;
  aggregate: string;
  groupByKey: string | null;
  data: { group: string | null; value: number }[];
};

type EntityOption = { value: string; label: string };

type WidgetDraft = {
  title: string;
  entityType: string;
  aggregate: (typeof AGGREGATES)[number];
  fieldKey: string;
  groupByKey: string;
  filters: WidgetFilter[];
};

function emptyDraft(entityOptions: EntityOption[]): WidgetDraft {
  return { title: "", entityType: entityOptions[0]?.value ?? "", aggregate: "COUNT", fieldKey: "", groupByKey: "", filters: [] };
}

function toDraft(widget: WidgetDef): WidgetDraft {
  return {
    title: widget.title,
    entityType: widget.entityType,
    aggregate: widget.aggregate,
    fieldKey: widget.fieldKey ?? "",
    groupByKey: widget.groupByKey ?? "",
    filters: widget.filters,
  };
}

/** Shared body for both the "add widget" and "edit widget" dialogs — same form-based, no-drag-and-drop shape as Module 10's own trigger/condition/action builder. */
function WidgetFormFields({
  draft,
  onChange,
  entityOptions,
}: {
  draft: WidgetDraft;
  onChange: (patch: Partial<WidgetDraft>) => void;
  entityOptions: EntityOption[];
}) {
  function updateFilter(index: number, patch: Partial<WidgetFilter>) {
    onChange({ filters: draft.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)) });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Title</label>
        <Input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Entity</label>
          <Select value={draft.entityType} onValueChange={(value) => onChange({ entityType: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {entityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Aggregate</label>
          <Select value={draft.aggregate} onValueChange={(value) => onChange({ aggregate: value as WidgetDraft["aggregate"] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AGGREGATES.map((aggregate) => (
                <SelectItem key={aggregate} value={aggregate}>{aggregate}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {draft.aggregate !== "COUNT" ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">Field to aggregate</label>
          <Input
            placeholder="e.g. customFields.yearsOfExperience"
            value={draft.fieldKey}
            onChange={(event) => onChange({ fieldKey: event.target.value })}
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <label className="text-sm font-medium">Group by (optional)</label>
        <Input
          placeholder="e.g. status, or customFields.<key>"
          value={draft.groupByKey}
          onChange={(event) => onChange({ groupByKey: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Filters (all must match)</label>
        {draft.filters.map((filter, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              placeholder="Field"
              value={filter.field}
              onChange={(event) => updateFilter(index, { field: event.target.value })}
            />
            <Select value={filter.operator} onValueChange={(value) => updateFilter(index, { operator: value as WidgetFilter["operator"] })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATORS.map((operator) => (
                  <SelectItem key={operator} value={operator}>{operator}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="w-32"
              placeholder="Value"
              value={String(filter.value)}
              onChange={(event) => updateFilter(index, { value: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onChange({ filters: draft.filters.filter((_, i) => i !== index) })}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ filters: [...draft.filters, { field: "", operator: "EQUALS", value: "" }] })}
        >
          <Plus /> Add filter
        </Button>
      </div>
    </div>
  );
}

function WidgetDialog({
  dashboardId,
  entityOptions,
  widget,
  widgetCount,
  onSaved,
  trigger,
}: {
  dashboardId: string;
  entityOptions: EntityOption[];
  widget?: WidgetDef;
  widgetCount: number;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WidgetDraft>(widget ? toDraft(widget) : emptyDraft(entityOptions));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setDraft(widget ? toDraft(widget) : emptyDraft(entityOptions));
  }, [open, widget, entityOptions]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload = {
        title: draft.title,
        entityType: draft.entityType,
        aggregate: draft.aggregate,
        fieldKey: draft.aggregate === "COUNT" ? undefined : draft.fieldKey || undefined,
        groupByKey: draft.groupByKey || undefined,
        filters: draft.filters.filter((filter) => filter.field.trim() !== ""),
        ...(widget ? {} : { sortOrder: widgetCount }),
      };
      if (widget) {
        await requestJson(`/api/dashboards/${dashboardId}/widgets/${widget.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await requestJson(`/api/dashboards/${dashboardId}/widgets`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      toast.success(widget ? "Widget updated." : "Widget added.");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save widget");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{widget ? "Edit widget" : "Add widget"}</DialogTitle>
          <DialogDescription>
            Every widget recomputes live against your own role and field permissions — nothing here is frozen at save
            time.
          </DialogDescription>
        </DialogHeader>
        <WidgetFormFields draft={draft} onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))} entityOptions={entityOptions} />
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !draft.title.trim() || !draft.entityType}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDashboardDialog({
  dashboard,
  onSaved,
}: {
  dashboard: DashboardMeta;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await requestJson(`/api/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, description: description || undefined, version: dashboard.version }),
      });
      toast.success("Dashboard updated.");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update dashboard");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WidgetCard({
  widget,
  result,
  dashboardId,
  entityOptions,
  widgetCount,
  canEdit,
  onChanged,
}: {
  widget: WidgetDef;
  result: WidgetResult | undefined;
  dashboardId: string;
  entityOptions: EntityOption[];
  widgetCount: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Remove widget "${widget.title}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await requestJson(`/api/dashboards/${dashboardId}/widgets/${widget.id}`, { method: "DELETE" });
      toast.success("Widget removed.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove widget");
    } finally {
      setDeleting(false);
    }
  }

  const rows = result?.data ?? [];
  const isGrouped = widget.groupByKey !== null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{widget.title}</CardTitle>
          <CardDescription>
            {widget.aggregate} of {widget.entityType}
            {widget.groupByKey ? ` grouped by ${widget.groupByKey}` : ""}
          </CardDescription>
        </div>
        {canEdit ? (
          <div className="flex gap-1">
            <WidgetDialog
              dashboardId={dashboardId}
              entityOptions={entityOptions}
              widget={widget}
              widgetCount={widgetCount}
              onSaved={onChanged}
              trigger={
                <Button variant="ghost" size="icon">
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <Button variant="ghost" size="icon" disabled={deleting} onClick={handleDelete}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {!isGrouped ? (
          <p className="text-3xl font-semibold tabular-nums">{rows[0]?.value ?? 0}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.group ?? "(none)"} className="flex items-center justify-between border-b py-1 text-sm last:border-0">
                <span className="text-muted-foreground">{row.group ?? "(none)"}</span>
                <span className="font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardDetailClient({
  dashboard: initialDashboard,
  widgets: initialWidgets,
  data: initialData,
  entityOptions,
  canEdit,
}: {
  dashboard: DashboardMeta;
  widgets: WidgetDef[];
  data: WidgetResult[];
  entityOptions: EntityOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [widgets, setWidgets] = useState(initialWidgets);
  const [data, setData] = useState(initialData);
  const [deleting, setDeleting] = useState(false);

  // Re-sync from fresh server props after router.refresh() — every widget
  // and dashboard mutation below triggers a refresh rather than managing
  // its own optimistic diff, since widget data must always come from a
  // fresh, permission-checked recomputation (never cached client-side).
  useEffect(() => setDashboard(initialDashboard), [initialDashboard]);
  useEffect(() => setWidgets(initialWidgets), [initialWidgets]);
  useEffect(() => setData(initialData), [initialData]);

  async function handleDeleteDashboard() {
    if (!window.confirm(`Delete "${dashboard.name}"? This removes all of its widgets too. This can't be undone.`)) return;
    setDeleting(true);
    try {
      await requestJson(`/api/dashboards/${dashboard.id}`, { method: "DELETE" });
      toast.success("Dashboard deleted.");
      router.push("/dashboards");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete dashboard");
      setDeleting(false);
    }
  }

  const resultsByWidgetId = new Map(data.map((result) => [result.widgetId, result]));

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboards">
          <ArrowLeft /> Dashboards
        </Link>
      </Button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dashboard.name}</h1>
          {dashboard.description ? <p className="text-muted-foreground">{dashboard.description}</p> : null}
          <p className="text-xs text-muted-foreground">Created by {dashboard.createdBy.name}</p>
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <RenameDashboardDialog dashboard={dashboard} onSaved={() => router.refresh()} />
            <Button variant="outline" size="sm" disabled={deleting} onClick={handleDeleteDashboard}>
              <Trash2 /> Delete
            </Button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <WidgetDialog
            dashboardId={dashboard.id}
            entityOptions={entityOptions}
            widgetCount={widgets.length}
            onSaved={() => router.refresh()}
            trigger={
              <Button size="sm">
                <Plus /> Add widget
              </Button>
            }
          />
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No widgets yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              result={resultsByWidgetId.get(widget.id)}
              dashboardId={dashboard.id}
              entityOptions={entityOptions}
              widgetCount={widgets.length}
              canEdit={canEdit}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
