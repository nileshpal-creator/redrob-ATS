"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const TRIGGER_LABEL: Record<string, string> = {
  STAGE_CHANGE: "Stage change",
  FIELD_UPDATE: "Field update",
  TIME_IN_STAGE: "Time in stage",
  FORM_SUBMISSION: "New application",
};

export type WorkflowVersionRow = {
  id: string;
  versionNumber: number;
  triggerType: string;
  createdBy: { name: string };
  createdAt: string;
};

/**
 * §10.2's "full version history... with the ability to roll back" — every
 * version ever saved stays listed regardless of which one is currently
 * active; rollback re-points activeVersionId at an older row rather than
 * mutating anything (see rollbackWorkflowDefinition's own comment).
 */
export function WorkflowVersionHistory({
  workflowId,
  version,
  activeVersionId,
  versions,
  canEdit,
}: {
  workflowId: string;
  version: number;
  activeVersionId: string | null;
  versions: WorkflowVersionRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  async function handleRollback(targetVersionId: string) {
    setRollingBackId(targetVersionId);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, targetVersionId }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Rollback failed");
      }
      toast.success("Rolled back to the selected version.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setRollingBackId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version history</CardTitle>
        <CardDescription>Every configuration this workflow has ever had.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {versions.map((version_) => (
          <div key={version_.id} className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">
                v{version_.versionNumber} — {TRIGGER_LABEL[version_.triggerType] ?? version_.triggerType}
                {version_.id === activeVersionId ? <Badge className="ml-2" variant="secondary">Active</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {version_.createdBy.name} &middot; {new Date(version_.createdAt).toLocaleString()}
              </p>
            </div>
            {canEdit && version_.id !== activeVersionId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRollback(version_.id)}
                disabled={rollingBackId !== null}
              >
                {rollingBackId === version_.id ? <Loader2 className="animate-spin" /> : null}
                Roll back to this version
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
