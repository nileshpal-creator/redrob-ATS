"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Settings2, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type PipelineStageRow = { id: string; name: string; isActive: boolean };

type ActiveDraft = { id?: string; name: string };

/**
 * Ordered stage editor (§10.1–10.2, §11.4: "stages configurable per
 * job/pipeline"). Two lists, matching PUT /api/jobs/[id]/pipeline-stages's
 * contract exactly: `active` is the full ordered list that gets submitted
 * verbatim (its sortOrder is the array index); `inactive` is display-only —
 * a stage stays there until "Reactivate" moves it back into `active`,
 * because the API deactivates anything with an existing id that's simply
 * omitted from the submission. Deactivating a stage with active
 * applications is blocked client-side (`activeApplicationCountByStageId`,
 * computed by the caller from the applications already loaded on the
 * pipeline page — no extra request needed).
 */
export function PipelineStageEditor({
  jobId,
  initialStages,
  activeApplicationCountByStageId,
}: {
  jobId: string;
  initialStages: PipelineStageRow[];
  activeApplicationCountByStageId: Record<string, number>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ActiveDraft[]>(
    initialStages.filter((stage) => stage.isActive).map((stage) => ({ id: stage.id, name: stage.name })),
  );
  const [inactive, setInactive] = useState<PipelineStageRow[]>(
    initialStages.filter((stage) => !stage.isActive),
  );
  const [submitting, setSubmitting] = useState(false);

  function resetFrom(stages: PipelineStageRow[]) {
    setActive(stages.filter((stage) => stage.isActive).map((stage) => ({ id: stage.id, name: stage.name })));
    setInactive(stages.filter((stage) => !stage.isActive));
  }

  function rename(index: number, name: string) {
    setActive((prev) => prev.map((stage, i) => (i === index ? { ...stage, name } : stage)));
  }

  function move(index: number, direction: -1 | 1) {
    setActive((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addStage() {
    setActive((prev) => [...prev, { name: "" }]);
  }

  function removeActive(index: number) {
    const stage = active[index];
    if (stage.id) {
      const count = activeApplicationCountByStageId[stage.id] ?? 0;
      if (count > 0) {
        toast.error(
          `${count} active application${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} still in "${stage.name}". Move them to another stage first.`,
        );
        return;
      }
      setInactive((prev) => [...prev, { id: stage.id!, name: stage.name, isActive: false }]);
    }
    setActive((prev) => prev.filter((_, i) => i !== index));
  }

  function reactivate(stageId: string) {
    const stage = inactive.find((s) => s.id === stageId);
    if (!stage) return;
    setInactive((prev) => prev.filter((s) => s.id !== stageId));
    setActive((prev) => [...prev, { id: stage.id, name: stage.name }]);
  }

  async function handleSave() {
    if (active.some((stage) => !stage.name.trim())) {
      toast.error("Stage names cannot be empty.");
      return;
    }
    const names = active.map((stage) => stage.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      toast.error("Stage names must be unique.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/pipeline-stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: active.map((stage) => ({ id: stage.id, name: stage.name.trim() })) }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to save pipeline stages");
      }
      toast.success("Pipeline updated.");
      resetFrom(body);
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save pipeline stages");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetFrom(initialStages);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 /> Manage stages
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>
            Add, rename, and reorder this job&apos;s pipeline. Removing a stage deactivates it — it&apos;s never
            deleted, and can be brought back later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {active.map((stage, index) => (
            <div key={stage.id ?? `new-${index}`} className="flex items-center gap-2">
              <Input value={stage.name} onChange={(event) => rename(index, event.target.value)} placeholder="Stage name" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={index === active.length - 1}
                onClick={() => move(index, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeActive(index)}
                aria-label={`Remove ${stage.name}`}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addStage}>
            <Plus /> Add stage
          </Button>
        </div>

        {inactive.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium text-muted-foreground">Deactivated</p>
            {inactive.map((stage) => (
              <div key={stage.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {stage.name} <Badge variant="secondary">inactive</Badge>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => reactivate(stage.id)}>
                  <Undo2 /> Reactivate
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting || active.length === 0}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
