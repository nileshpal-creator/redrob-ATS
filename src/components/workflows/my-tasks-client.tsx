"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type TaskStatus = "OPEN" | "DONE" | "APPROVED" | "REJECTED";

export type MyTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: string | null;
  createdAt: string;
  application: { id: string; candidate: { name: string }; job: { title: string } };
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
 * "My Tasks" (§10.2's CREATE_TASK/REQUEST_APPROVAL actions) — every
 * WorkflowTask assigned to the viewer, across every application they can
 * or can't otherwise see, since assignment itself is the access grant here
 * (assertWorkflowTaskAccess's unconditional assignee path). Without this
 * page, an automation-created task would only be discoverable by whoever
 * happens to open the exact application it lives on.
 */
export function MyTasksClient({ tasks }: { tasks: MyTaskRow[] }) {
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
    return <p className="text-sm text-muted-foreground">No tasks assigned to you.</p>;
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
              <Link href={`/applications/${task.application.id}`} className="hover:underline">
                {task.application.candidate.name} — {task.application.job.title}
              </Link>
              {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ""}
            </p>

            {task.status === "OPEN" ? (
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
