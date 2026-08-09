import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can, getEffectiveScope } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getOrganizationSettings } from "@/lib/services/organization";
import { DataRetentionClient } from "@/components/admin/data-retention-client";

export default async function DataRetentionPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.ORGANIZATION, "READ");

  const [organization, canEditSettings, approveScope] = await Promise.all([
    getOrganizationSettings(context),
    can(context, ENTITY.ORGANIZATION, "UPDATE"),
    getEffectiveScope(context, ENTITY.CANDIDATE, "APPROVE"),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data Retention &amp; Erasure</h1>
        <p className="text-muted-foreground">
          §13: GDPR-aligned retention limits and a staff-initiated &quot;right to be forgotten&quot; queue.
          Anonymizing overwrites a candidate&apos;s personal fields while keeping their application/interview/
          offer history intact; hard delete removes the record outright and is blocked while any application
          exists.
        </p>
      </div>
      <DataRetentionClient
        initialRetentionDays={organization.candidateRetentionDays}
        canEditSettings={canEditSettings}
        canDecide={approveScope === "ALL"}
      />
    </div>
  );
}
