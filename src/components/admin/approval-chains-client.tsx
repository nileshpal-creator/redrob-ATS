"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RoleOption = { id: string; name: string };
type StepConfig = { id: string; stepOrder: number; name: string; requiredRoleId: string; requiredRole: { id: string; name: string } };
type StepDraft = { name: string; requiredRoleId: string };

function ChainEditor({
  entityType,
  initialSteps,
  roles,
  canEdit,
}: {
  entityType: "JOB" | "OFFER";
  initialSteps: StepConfig[];
  roles: RoleOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<StepDraft[]>(
    initialSteps.map((step) => ({ name: step.name, requiredRoleId: step.requiredRoleId })),
  );
  const [saving, setSaving] = useState(false);

  function update(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { name: "", requiredRoleId: roles[0]?.id ?? "" }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    if (steps.some((step) => !step.name.trim() || !step.requiredRoleId)) {
      toast.error("Every step needs a name and a required role.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/approval-steps/${entityType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: steps.map((step, index) => ({ stepOrder: index + 1, name: step.name.trim(), requiredRoleId: step.requiredRoleId })),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to save.");
      }
      toast.success(`${entityType === "JOB" ? "Job" : "Offer"} approval chain saved.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No configured chain — a single approval step decided by anyone with the Approve permission.
          </p>
        ) : null}
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="flex items-end gap-2">
              <span className="pb-2 text-sm font-medium text-muted-foreground">{index + 1}.</span>
              <Input
                placeholder="Step name (e.g. Hiring Manager review)"
                value={step.name}
                disabled={!canEdit}
                onChange={(event) => update(index, { name: event.target.value })}
                className="max-w-64"
              />
              <Select
                value={step.requiredRoleId}
                disabled={!canEdit}
                onValueChange={(value) => update(index, { requiredRoleId: value })}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Required role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit ? (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Move step up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Move step down"
                    disabled={index === steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Remove step" onClick={() => removeStep(index)}>
                    <Trash2 className="size-4" />
                  </Button>
                </>
              ) : null}
            </div>
          ))}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={addStep} disabled={roles.length === 0}>
              <Plus /> Add step
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        ) : null}
        {canEdit && roles.length === 0 ? (
          <p className="text-xs text-muted-foreground">No roles available to assign — create a role first.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ApprovalChainsClient({
  canViewJob,
  canViewOffer,
  canEditJob,
  canEditOffer,
  initialJobSteps,
  initialOfferSteps,
  roles,
}: {
  canViewJob: boolean;
  canViewOffer: boolean;
  canEditJob: boolean;
  canEditOffer: boolean;
  initialJobSteps: StepConfig[];
  initialOfferSteps: StepConfig[];
  roles: RoleOption[];
}) {
  const defaultTab = canViewJob ? "JOB" : "OFFER";

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        {canViewJob ? <TabsTrigger value="JOB">Job Approval</TabsTrigger> : null}
        {canViewOffer ? <TabsTrigger value="OFFER">Offer Approval</TabsTrigger> : null}
      </TabsList>
      {canViewJob ? (
        <TabsContent value="JOB">
          <ChainEditor entityType="JOB" initialSteps={initialJobSteps} roles={roles} canEdit={canEditJob} />
        </TabsContent>
      ) : null}
      {canViewOffer ? (
        <TabsContent value="OFFER">
          <ChainEditor entityType="OFFER" initialSteps={initialOfferSteps} roles={roles} canEdit={canEditOffer} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
