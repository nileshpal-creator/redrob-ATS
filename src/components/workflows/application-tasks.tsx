"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type Person = { id: string; name: string; email: string };
type TaskStatus = "OPEN" | "DONE" | "APPROVED" | "REJECTED";

export type ApplicationTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: string | null;
  assignedTo: Person;
  createdAt: string;
  completedAt: string | null;
};

const STATUS_BADGE_VARIANT: Record<TaskStatus, "default" | "secondary" | "destructive" | "outline"> = {
  OPEN: "outline",
  DONE: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

/**
 * Tasks/approvals section for the Application detail page (§10.2's
 * CREATE_TASK/REQUEST_APPROVAL actions). No create action here — a
 * WorkflowTask only ever exists as a side effect of a workflow firing (see
 * executeCreateTask/executeRequestApproval in src/lib/services/
 * workflows.ts). The schema doesn't distinguish a plain to-do from an
 * approval request on the row itself, so every open task offers both
 * resolutions — whoever acts picks the one that matches what the task
 * actually asks for.
 */
export function ApplicationTasks({
  tasks,
  canManageAll,
  currentUserId,
}: {
  tasks: ApplicationTask[];
  /** Caller has APPLICATION:UPDATE over this application's owner — mirrors assertWorkflowTaskAccess's first path. */
  canManageAll: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [actingId, setActingId] = useState<string | null>(null);

  async function resolve(taskId: string, action: "complete" | "approve" | "reject") {
    setActingId(taskId);
    try {
      if (action === "complete") {
        await requestJson(`/api/workflow-tasks/${taskId}/complete`, { method: "POST" });
        toast.success("Task marked done.");
      } else {
        await requestJson(`/api/workflow-tasks/${taskId}/decide`, {
          method: "POST",
          body: JSON.stringify({ outcome: action === "approve" ? "APPROVED" : "REJECTED" }),
        });
        toast.success(action === "approve" ? "Approved." : "Rejected.");
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setActingId(null);
    }
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks yet — created automatically by workflow automations.</p>;
  }

  return (
    <div className="space-y-4">
      {tasks.map((task, index) => (
        <div key={task.id}>
          {index > 0 ? <Separator className="mb-3" /> : null}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{task.title}</p>
              <Badge variant={STATUS_BADGE_VARIANT[task.status]}>{task.status}</Badge>
            </div>
            {task.description ? <p className="text-sm text-muted-foreground">{task.description}</p> : null}
            <p className="text-xs text-muted-foreground">
              Assigned to {task.assignedTo.name}
              {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ""}
            </p>

            {task.status === "OPEN" && (canManageAll || task.assignedTo.id === currentUserId) ? (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={actingId === task.id} onClick={() => resolve(task.id, "complete")}>
                  {actingId === task.id ? <Loader2 className="animate-spin" /> : <Check />}
                  Mark done
                </Button>
                <Button size="sm" variant="outline" disabled={actingId === task.id} onClick={() => resolve(task.id, "approve")}>
                  <ThumbsUp /> Approve
                </Button>
                <Button size="sm" variant="outline" disabled={actingId === task.id} onClick={() => resolve(task.id, "reject")}>
                  <ThumbsDown /> Reject
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
