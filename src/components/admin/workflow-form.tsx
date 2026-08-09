"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkflowAction, WorkflowCondition } from "@/lib/validations/workflow";

type TriggerType = "STAGE_CHANGE" | "FIELD_UPDATE" | "TIME_IN_STAGE" | "FORM_SUBMISSION";
type ActionType = "SEND_EMAIL" | "CREATE_TASK" | "CHANGE_FIELD" | "REASSIGN_OWNER" | "REQUEST_APPROVAL";
type Operator = "EQUALS" | "NOT_EQUALS" | "GREATER_THAN" | "LESS_THAN" | "CONTAINS";

const OPERATORS: { value: Operator; label: string }[] = [
  { value: "EQUALS", label: "equals" },
  { value: "NOT_EQUALS", label: "does not equal" },
  { value: "GREATER_THAN", label: "is greater than" },
  { value: "LESS_THAN", label: "is less than" },
  { value: "CONTAINS", label: "contains" },
];

type ConditionDraft = { field: string; operator: Operator; value: string };

type ActionDraft =
  | { type: "SEND_EMAIL"; templateId: string }
  | { type: "CREATE_TASK"; title: string; description: string; assignedToId: string; dueInDays: string }
  | { type: "CHANGE_FIELD"; fieldKey: string; value: string }
  | { type: "REASSIGN_OWNER"; userId: string }
  | { type: "REQUEST_APPROVAL"; title: string; description: string; approverId: string };

function defaultActionDraft(type: ActionType): ActionDraft {
  switch (type) {
    case "SEND_EMAIL":
      return { type, templateId: "" };
    case "CREATE_TASK":
      return { type, title: "", description: "", assignedToId: "", dueInDays: "" };
    case "CHANGE_FIELD":
      return { type, fieldKey: "", value: "" };
    case "REASSIGN_OWNER":
      return { type, userId: "" };
    case "REQUEST_APPROVAL":
      return { type, title: "", description: "", approverId: "" };
  }
}

/**
 * The stored WorkflowAction/WorkflowCondition shapes (optional
 * description/dueInDays, condition value as string|number) don't match the
 * editable draft shapes above (every field a plain string, always present —
 * what a controlled <Input>/<Textarea> needs). Converting on load, rather
 * than casting past the mismatch, keeps every input controlled from first
 * render and keeps configUnchangedFromInitial's comparison apples-to-apples.
 */
function toActionDraft(action: WorkflowAction): ActionDraft {
  switch (action.type) {
    case "SEND_EMAIL":
      return { type: action.type, templateId: action.templateId };
    case "CREATE_TASK":
      return {
        type: action.type,
        title: action.title,
        description: action.description ?? "",
        assignedToId: action.assignedToId,
        dueInDays: action.dueInDays !== undefined ? String(action.dueInDays) : "",
      };
    case "CHANGE_FIELD":
      return { type: action.type, fieldKey: action.fieldKey, value: action.value === undefined ? "" : String(action.value) };
    case "REASSIGN_OWNER":
      return { type: action.type, userId: action.userId };
    case "REQUEST_APPROVAL":
      return {
        type: action.type,
        title: action.title,
        description: action.description ?? "",
        approverId: action.approverId,
      };
  }
}

function toConditionDraft(condition: WorkflowCondition): ConditionDraft {
  return { field: condition.field, operator: condition.operator, value: String(condition.value) };
}

export type WorkflowFormReferenceData = {
  jobs: { id: string; title: string }[];
  stages: { id: string; jobId: string; name: string }[];
  templates: { id: string; name: string }[];
  customFields: { key: string; label: string }[];
  users: { id: string; name: string }[];
};

export type WorkflowInitial = {
  id: string;
  name: string;
  jobId: string | null;
  isActive: boolean;
  version: number;
  activeVersion: {
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditions: WorkflowCondition[];
    actions: WorkflowAction[];
  };
};

function toStringConfig(triggerType: TriggerType, config: Record<string, unknown>): Record<string, string> {
  switch (triggerType) {
    case "STAGE_CHANGE":
      return { toStageId: String(config.toStageId ?? "") };
    case "FIELD_UPDATE":
      return { fieldKey: String(config.fieldKey ?? "") };
    case "TIME_IN_STAGE":
      return { stageId: String(config.stageId ?? ""), days: String(config.days ?? "") };
    case "FORM_SUBMISSION":
      return {};
  }
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

/**
 * §10.2's builder: trigger + AND-only conditions + one-or-more actions.
 * Deliberately plain useState rather than react-hook-form — conditions and
 * actions are dynamic, differently-shaped-per-type arrays, and there is no
 * useFieldArray precedent elsewhere in this codebase to extend.
 */
export function WorkflowForm({
  mode,
  referenceData,
  initial,
  readOnly = false,
}: {
  mode: "create" | "edit";
  referenceData: WorkflowFormReferenceData;
  initial?: WorkflowInitial;
  /** Viewer has READ but not UPDATE — render the builder for context, but nothing in it is interactive. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [jobId, setJobId] = useState<string>(initial?.jobId ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [triggerType, setTriggerType] = useState<TriggerType>(initial?.activeVersion.triggerType ?? "STAGE_CHANGE");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, string>>(
    initial ? toStringConfig(initial.activeVersion.triggerType, initial.activeVersion.triggerConfig) : {},
  );
  const [conditions, setConditions] = useState<ConditionDraft[]>(
    initial ? initial.activeVersion.conditions.map(toConditionDraft) : [],
  );
  const [actions, setActions] = useState<ActionDraft[]>(
    initial ? initial.activeVersion.actions.map(toActionDraft) : [defaultActionDraft("SEND_EMAIL")],
  );
  const [submitting, setSubmitting] = useState(false);

  const stagesForJob = referenceData.stages.filter((stage) => stage.jobId === jobId);
  const requiresJob = triggerType === "STAGE_CHANGE" || triggerType === "TIME_IN_STAGE";

  function handleTriggerTypeChange(next: TriggerType) {
    setTriggerType(next);
    setTriggerConfig({});
  }

  function updateCondition(index: number, patch: Partial<ConditionDraft>) {
    setConditions((prev) => prev.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)));
  }

  function updateAction(index: number, next: ActionDraft) {
    setActions((prev) => prev.map((action, i) => (i === index ? next : action)));
  }

  function buildTriggerPayload() {
    switch (triggerType) {
      case "STAGE_CHANGE":
        return { type: triggerType, config: { toStageId: triggerConfig.toStageId ?? "" } };
      case "FIELD_UPDATE":
        return { type: triggerType, config: { fieldKey: triggerConfig.fieldKey ?? "" } };
      case "TIME_IN_STAGE":
        return {
          type: triggerType,
          config: { stageId: triggerConfig.stageId ?? "", days: Number(triggerConfig.days ?? 0) },
        };
      case "FORM_SUBMISSION":
        return { type: triggerType, config: {} };
    }
  }

  function buildActionPayload(action: ActionDraft) {
    switch (action.type) {
      case "SEND_EMAIL":
        return { type: action.type, templateId: action.templateId };
      case "CREATE_TASK":
        return {
          type: action.type,
          title: action.title,
          description: action.description || undefined,
          assignedToId: action.assignedToId,
          dueInDays: action.dueInDays ? Number(action.dueInDays) : undefined,
        };
      case "CHANGE_FIELD":
        return { type: action.type, fieldKey: action.fieldKey, value: action.value };
      case "REASSIGN_OWNER":
        return { type: action.type, userId: action.userId };
      case "REQUEST_APPROVAL":
        return {
          type: action.type,
          title: action.title,
          description: action.description || undefined,
          approverId: action.approverId,
        };
    }
  }

  function configUnchangedFromInitial() {
    if (!initial) return false;
    const initialTrigger = { type: initial.activeVersion.triggerType, config: toStringConfig(initial.activeVersion.triggerType, initial.activeVersion.triggerConfig) };
    const currentTrigger = { type: triggerType, config: triggerConfig };
    // Compare against the same normalized draft shape `conditions`/`actions`
    // state was initialized from — comparing against the raw stored shape
    // would flag a false change on every save (e.g. a numeric condition
    // value normalizes to a string) and spawn a needless new version.
    const initialConditions = initial.activeVersion.conditions.map(toConditionDraft);
    const initialActions = initial.activeVersion.actions.map(toActionDraft);
    return (
      JSON.stringify(initialTrigger) === JSON.stringify(currentTrigger) &&
      JSON.stringify(initialConditions) === JSON.stringify(conditions) &&
      JSON.stringify(initialActions) === JSON.stringify(actions)
    );
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (requiresJob && !jobId) {
      toast.error("This trigger type requires a specific job — pipeline stages are job-scoped.");
      return;
    }
    if (actions.length === 0) {
      toast.error("At least one action is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "create") {
        const created = await requestJson("/api/workflows", {
          method: "POST",
          body: JSON.stringify({
            name,
            jobId: jobId || null,
            isActive,
            trigger: buildTriggerPayload(),
            conditions: conditions.map((condition) => ({ ...condition })),
            actions: actions.map(buildActionPayload),
          }),
        });
        toast.success(`Workflow "${created.name}" created.`);
        router.push(`/admin/workflows/${created.id}`);
        router.refresh();
      } else if (initial) {
        const configChanged = !configUnchangedFromInitial();
        const updated = await requestJson(`/api/workflows/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            version: initial.version,
            name,
            isActive,
            ...(configChanged
              ? {
                  trigger: buildTriggerPayload(),
                  conditions: conditions.map((condition) => ({ ...condition })),
                  actions: actions.map(buildActionPayload),
                }
              : {}),
          }),
        });
        toast.success(`Workflow "${updated.name}" saved${configChanged ? " — new version created" : ""}.`);
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save workflow");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4" inert={readOnly}>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Notify HM after screening" />
          </div>
          <div className="space-y-2">
            <Label>Applies to</Label>
            <Select value={jobId || "__all__"} onValueChange={(value) => setJobId(value === "__all__" ? "" : value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Every job</SelectItem>
                {referenceData.jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {requiresJob ? (
              <p className="text-xs text-muted-foreground">
                Stage-based triggers reference one job&apos;s pipeline — this workflow must be scoped to a job.
              </p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            Active
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger</CardTitle>
          <CardDescription>When this happens…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={triggerType} onValueChange={(value) => handleTriggerTypeChange(value as TriggerType)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="STAGE_CHANGE">Application moves to a stage</SelectItem>
              <SelectItem value="FIELD_UPDATE">A custom field is updated</SelectItem>
              <SelectItem value="TIME_IN_STAGE">Application has been in a stage for N days</SelectItem>
              <SelectItem value="FORM_SUBMISSION">A new application is submitted</SelectItem>
            </SelectContent>
          </Select>

          {triggerType === "STAGE_CHANGE" ? (
            <Select
              value={triggerConfig.toStageId ?? ""}
              onValueChange={(value) => setTriggerConfig({ toStageId: value })}
              disabled={!jobId}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Destination stage" /></SelectTrigger>
              <SelectContent>
                {stagesForJob.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {triggerType === "FIELD_UPDATE" ? (
            <Select value={triggerConfig.fieldKey ?? ""} onValueChange={(value) => setTriggerConfig({ fieldKey: value })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Custom field" /></SelectTrigger>
              <SelectContent>
                {referenceData.customFields.map((field) => (
                  <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {triggerType === "TIME_IN_STAGE" ? (
            <div className="flex gap-3">
              <Select
                value={triggerConfig.stageId ?? ""}
                onValueChange={(value) => setTriggerConfig((prev) => ({ ...prev, stageId: value }))}
                disabled={!jobId}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>
                  {stagesForJob.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                className="w-32"
                placeholder="Days"
                value={triggerConfig.days ?? ""}
                onChange={(event) => setTriggerConfig((prev) => ({ ...prev, days: event.target.value }))}
              />
            </div>
          ) : null}

          {triggerType === "FORM_SUBMISSION" ? (
            <p className="text-sm text-muted-foreground">Fires once, immediately, for every new application.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conditions</CardTitle>
          <CardDescription>…and all of these are true (leave empty to always run)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {conditions.map((condition, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Select value={condition.field} onValueChange={(value) => updateCondition(index, { field: value })}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Field" /></SelectTrigger>
                <SelectContent>
                  {referenceData.customFields.map((field) => (
                    <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={condition.operator} onValueChange={(value) => updateCondition(index, { operator: value as Operator })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((operator) => (
                    <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="w-40"
                placeholder="Value"
                value={condition.value}
                onChange={(event) => updateCondition(index, { value: event.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove condition"
                onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConditions((prev) => [...prev, { field: "", operator: "EQUALS", value: "" }])}
          >
            <Plus /> Add condition
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>…then do all of this</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actions.map((action, index) => (
            <div key={index} className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Select
                  value={action.type}
                  onValueChange={(value) => updateAction(index, defaultActionDraft(value as ActionType))}
                >
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SEND_EMAIL">Send templated email</SelectItem>
                    <SelectItem value="CREATE_TASK">Create a task</SelectItem>
                    <SelectItem value="CHANGE_FIELD">Change a custom field</SelectItem>
                    <SelectItem value="REASSIGN_OWNER">Reassign owner</SelectItem>
                    <SelectItem value="REQUEST_APPROVAL">Request approval</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove action"
                  onClick={() => setActions((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              {action.type === "SEND_EMAIL" ? (
                <Select value={action.templateId} onValueChange={(value) => updateAction(index, { ...action, templateId: value })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Email template" /></SelectTrigger>
                  <SelectContent>
                    {referenceData.templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {action.type === "CREATE_TASK" || action.type === "REQUEST_APPROVAL" ? (
                <div className="space-y-2">
                  <Input
                    placeholder="Task title"
                    value={action.title}
                    onChange={(event) => updateAction(index, { ...action, title: event.target.value })}
                  />
                  <Textarea
                    placeholder="Description (optional)"
                    rows={2}
                    value={action.description}
                    onChange={(event) => updateAction(index, { ...action, description: event.target.value })}
                  />
                  <div className="flex gap-2">
                    <Select
                      value={action.type === "CREATE_TASK" ? action.assignedToId : action.approverId}
                      onValueChange={(value) =>
                        updateAction(
                          index,
                          action.type === "CREATE_TASK" ? { ...action, assignedToId: value } : { ...action, approverId: value },
                        )
                      }
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder={action.type === "CREATE_TASK" ? "Assignee" : "Approver"} /></SelectTrigger>
                      <SelectContent>
                        {referenceData.users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {action.type === "CREATE_TASK" ? (
                      <Input
                        type="number"
                        min={1}
                        className="w-32"
                        placeholder="Due in days"
                        value={action.dueInDays}
                        onChange={(event) => updateAction(index, { ...action, dueInDays: event.target.value })}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}

              {action.type === "CHANGE_FIELD" ? (
                <div className="flex gap-2">
                  <Select value={action.fieldKey} onValueChange={(value) => updateAction(index, { ...action, fieldKey: value })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Field" /></SelectTrigger>
                    <SelectContent>
                      {referenceData.customFields.map((field) => (
                        <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="New value"
                    value={action.value}
                    onChange={(event) => updateAction(index, { ...action, value: event.target.value })}
                  />
                </div>
              ) : null}

              {action.type === "REASSIGN_OWNER" ? (
                <Select value={action.userId} onValueChange={(value) => updateAction(index, { ...action, userId: value })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="New owner" /></SelectTrigger>
                  <SelectContent>
                    {referenceData.users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setActions((prev) => [...prev, defaultActionDraft("SEND_EMAIL")])}>
            <Plus /> Add action
          </Button>
        </CardContent>
      </Card>

      {readOnly ? null : (
        <>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {mode === "create" ? "Create workflow" : "Save changes"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
