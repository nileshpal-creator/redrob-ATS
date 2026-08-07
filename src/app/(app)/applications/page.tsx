import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listApplications } from "@/lib/services/applications";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { applicationQuerySchema } from "@/lib/validations/application";
import { ApplicationsClient } from "@/components/applications/applications-client";

export default async function ApplicationsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.APPLICATION, "READ");

  const [result, rejectionReasons, canCreate] = await Promise.all([
    listApplications(context, applicationQuerySchema.parse({})),
    getControlledListValues("REJECTION_REASON"),
    can(context, ENTITY.APPLICATION, "CREATE"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="text-muted-foreground">Applications you can see, based on your role&apos;s access.</p>
      </div>
      <ApplicationsClient
        initialResult={JSON.parse(JSON.stringify(result))}
        rejectionReasons={rejectionReasons.values}
        canCreate={canCreate}
      />
    </div>
  );
}
