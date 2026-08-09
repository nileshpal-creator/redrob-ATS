import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { NotFoundError } from "@/lib/errors";
import { getWorkflowDefinition, getWorkflowFormReferenceData } from "@/lib/services/workflow-definitions";
import type { WorkflowAction, WorkflowCondition } from "@/lib/validations/workflow";
import { BackLink } from "@/components/layout/back-link";
import { WorkflowForm } from "@/components/admin/workflow-form";
import { WorkflowVersionHistory } from "@/components/admin/workflow-version-history";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const definition = await getWorkflowDefinition(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/admin/workflows");
    throw error;
  });

  // Mirrors assertWorkflowDefinitionAccess's own two-path check (an
  // unscoped grant, or one scoped to this workflow's own creator) — a
  // Recruiting Manager's TEAM-scope grant must still show the edit form for
  // a team member's workflow, not just the creator's own.
  const [referenceData, canEditAll, canEditOwn] = await Promise.all([
    getWorkflowFormReferenceData(context),
    can(context, ENTITY.WORKFLOW_DEFINITION, "UPDATE"),
    can(context, ENTITY.WORKFLOW_DEFINITION, "UPDATE", { ownerId: definition.createdById }),
  ]);
  const canEdit = canEditAll || canEditOwn;

  if (!definition.activeVersion) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <BackLink href="/admin/workflows" label="Workflows" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{definition.name}</h1>
        <p className="text-muted-foreground">
          Created by {definition.createdBy.name} &middot; {new Date(definition.createdAt).toLocaleDateString()}
        </p>
      </div>
      <WorkflowForm
        mode="edit"
        referenceData={referenceData}
        readOnly={!canEdit}
        initial={{
          id: definition.id,
          name: definition.name,
          jobId: definition.jobId,
          isActive: definition.isActive,
          version: definition.version,
          activeVersion: {
            triggerType: definition.activeVersion.triggerType,
            triggerConfig: definition.activeVersion.triggerConfig as Record<string, unknown>,
            conditions: definition.activeVersion.conditions as unknown as WorkflowCondition[],
            actions: definition.activeVersion.actions as unknown as WorkflowAction[],
          },
        }}
      />
      <WorkflowVersionHistory
        workflowId={definition.id}
        version={definition.version}
        activeVersionId={definition.activeVersionId}
        versions={JSON.parse(JSON.stringify(definition.versions))}
        canEdit={canEdit}
      />
    </div>
  );
}
