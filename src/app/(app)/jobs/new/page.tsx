import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { JobForm } from "@/components/jobs/job-form";

export default async function NewJobPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.JOB, "CREATE");

  const [departments, locations] = await Promise.all([
    getControlledListValues("DEPARTMENT"),
    getControlledListValues("LOCATION"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
        <p className="text-muted-foreground">Saved as a draft — submit it for approval once ready.</p>
      </div>
      <JobForm mode="create" departments={departments.values} locations={locations.values} />
    </div>
  );
}
