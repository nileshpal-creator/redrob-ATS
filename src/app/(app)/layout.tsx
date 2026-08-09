import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }

  const [
    showJobsNav,
    showCandidatesNav,
    showApplicationsNav,
    showInterviewsNav,
    canViewOfferReports,
    showWorkflowsNav,
    showDashboardsNav,
  ] = await Promise.all([
    can(context, ENTITY.JOB, "READ"),
    can(context, ENTITY.CANDIDATE, "READ"),
    can(context, ENTITY.APPLICATION, "READ"),
    can(context, ENTITY.INTERVIEW, "READ"),
    can(context, ENTITY.OFFER, "READ"),
    can(context, ENTITY.WORKFLOW_DEFINITION, "READ"),
    can(context, ENTITY.DASHBOARD, "READ"),
  ]);
  // Reports are reachable with either JOB:READ or OFFER:READ (see
  // src/app/(app)/reports/page.tsx) — showJobsNav already answers the first half.
  const showReportsNav = showJobsNav || canViewOfferReports;

  return (
    <div className="flex h-svh">
      <AppSidebar
        showAdminNav={context.isSuperAdmin}
        showJobsNav={showJobsNav}
        showCandidatesNav={showCandidatesNav}
        showApplicationsNav={showApplicationsNav}
        showInterviewsNav={showInterviewsNav}
        showReportsNav={showReportsNav}
        showWorkflowsNav={showWorkflowsNav}
        showDashboardsNav={showDashboardsNav}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar name={context.name} email={context.email} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
