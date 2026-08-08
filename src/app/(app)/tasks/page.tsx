import { getSessionContext } from "@/lib/authz/session-context";
import { listWorkflowTasks } from "@/lib/services/workflow-tasks";
import { MyTasksClient } from "@/components/workflows/my-tasks-client";

export default async function MyTasksPage() {
  const context = await getSessionContext();
  if (!context) return null;

  // No applicationId in the query — listWorkflowTasks resolves this to
  // every task assigned to the caller, regardless of their broader
  // Application scope (see its own comment): assignment is the access
  // grant here, not a permission this page needs to check.
  const tasks = await listWorkflowTasks(context, {});

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Tasks</h1>
        <p className="text-muted-foreground">Tasks and approval requests assigned to you by workflow automations.</p>
      </div>
      <MyTasksClient tasks={JSON.parse(JSON.stringify(tasks))} />
    </div>
  );
}
