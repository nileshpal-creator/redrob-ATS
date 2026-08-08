import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { getWorkflowFormReferenceData } from "@/lib/services/workflow-definitions";
import { WorkflowForm } from "@/components/admin/workflow-form";

export default async function NewWorkflowPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.WORKFLOW_DEFINITION, "CREATE", "/admin/workflows");

  const referenceData = await getWorkflowFormReferenceData(context);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New workflow</h1>
        <p className="text-muted-foreground">Define a trigger, optional conditions, and one or more actions.</p>
      </div>
      <WorkflowForm mode="create" referenceData={referenceData} />
    </div>
  );
}
