import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listJobs } from "@/lib/services/jobs";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { jobQuerySchema } from "@/lib/validations/job";
import { JobsClient } from "@/components/jobs/jobs-client";

export default async function JobsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.JOB, "READ");

  const [result, departments, locations, canCreate] = await Promise.all([
    listJobs(context, jobQuerySchema.parse({})),
    getControlledListValues("DEPARTMENT"),
    getControlledListValues("LOCATION"),
    can(context, ENTITY.JOB, "CREATE"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-muted-foreground">Requisitions you can see, based on your role&apos;s access.</p>
      </div>
      <JobsClient
        initialResult={JSON.parse(JSON.stringify(result))}
        departments={departments.values}
        locations={locations.values}
        canCreate={canCreate}
      />
    </div>
  );
}
