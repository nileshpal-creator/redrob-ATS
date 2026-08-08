import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listWorkflowDefinitions } from "@/lib/services/workflow-definitions";
import { workflowDefinitionQuerySchema } from "@/lib/validations/workflow";
import { WorkflowsListClient } from "@/components/admin/workflows-list-client";

export default async function WorkflowsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.WORKFLOW_DEFINITION, "READ");

  const [workflows, canCreate] = await Promise.all([
    listWorkflowDefinitions(context, workflowDefinitionQuerySchema.parse({})),
    can(context, ENTITY.WORKFLOW_DEFINITION, "CREATE"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workflow Automations</h1>
        <p className="text-muted-foreground">
          Trigger-condition-action automations that fire on pipeline events (§10.2) — email sends, tasks, approvals,
          field changes and owner reassignment.
        </p>
      </div>
      <WorkflowsListClient workflows={workflows} canCreate={canCreate} />
    </div>
  );
}
