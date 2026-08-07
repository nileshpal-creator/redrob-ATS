import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { ForbiddenError } from "@/lib/authz/authorize";
import { listJobs } from "@/lib/services/jobs";
import { listUsers } from "@/lib/services/users";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { jobQuerySchema } from "@/lib/validations/job";
import { ReportsClient } from "@/components/reports/reports-client";

export default async function ReportsPage() {
  const context = await getSessionContext();
  if (!context) return null;

  const [canViewJobReports, canViewOfferReports] = await Promise.all([
    can(context, ENTITY.JOB, "READ"),
    can(context, ENTITY.OFFER, "READ"),
  ]);
  if (!canViewJobReports && !canViewOfferReports) {
    redirect("/");
  }

  // Directory access (USER:READ) isn't guaranteed for every role that can
  // reach this page (e.g. Interviewer) — the recruiter filter degrades to
  // "no options" rather than crashing the page for those roles.
  const listUsersOrEmpty = () => listUsers(context).catch((error) => {
    if (error instanceof ForbiddenError) return [];
    throw error;
  });

  const [jobsResult, recruiters, sources, departments, locations] = await Promise.all([
    canViewJobReports ? listJobs(context, jobQuerySchema.parse({ pageSize: 100 })) : Promise.resolve({ jobs: [] }),
    listUsersOrEmpty(),
    getControlledListValues("CANDIDATE_SOURCE"),
    getControlledListValues("DEPARTMENT"),
    getControlledListValues("LOCATION"),
  ]);

  const jobOptions = jobsResult.jobs.map((job) => ({ id: job.id, label: job.title }));
  const recruiterOptions = recruiters.filter((user) => user.isActive).map((user) => ({ id: user.id, label: user.name }));
  const sourceOptions = sources.values.map((value) => ({ id: value.id, label: value.label }));
  const departmentOptions = departments.values.map((value) => ({ id: value.id, label: value.label }));
  const locationOptions = locations.values.map((value) => ({ id: value.id, label: value.label }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">
          Pipeline, time-to-fill/offer, recruiter workload and offer TAT reporting (§11.12). Every report is scoped
          to what your role can already see.
        </p>
      </div>
      <ReportsClient
        canViewJobReports={canViewJobReports}
        canViewOfferReports={canViewOfferReports}
        jobs={jobOptions}
        departments={departmentOptions}
        locations={locationOptions}
        recruiters={recruiterOptions}
        sources={sourceOptions}
      />
    </div>
  );
}
