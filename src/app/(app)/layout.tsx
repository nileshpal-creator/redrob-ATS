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
    canViewUsers,
    canViewRoles,
    canViewCustomFields,
    canViewCommunicationTemplates,
    canViewOrganizationSettings,
    canViewAuditLog,
  ] = await Promise.all([
    can(context, ENTITY.JOB, "READ"),
    can(context, ENTITY.CANDIDATE, "READ"),
    can(context, ENTITY.APPLICATION, "READ"),
    can(context, ENTITY.INTERVIEW, "READ"),
    can(context, ENTITY.OFFER, "READ"),
    can(context, ENTITY.WORKFLOW_DEFINITION, "READ"),
    can(context, ENTITY.DASHBOARD, "READ"),
    can(context, ENTITY.USER, "READ"),
    can(context, ENTITY.ROLE, "READ"),
    can(context, ENTITY.CUSTOM_FIELD_DEFINITION, "READ"),
    can(context, ENTITY.COMMUNICATION_TEMPLATE, "READ"),
    can(context, ENTITY.ORGANIZATION, "READ"),
    can(context, ENTITY.AUDIT_LOG, "READ"),
  ]);
  // Reports are reachable with either JOB:READ or OFFER:READ (see
  // src/app/(app)/reports/page.tsx) — showJobsNav already answers the first half.
  const showReportsNav = showJobsNav || canViewOfferReports;

  // Per-item admin visibility — each key mirrors the exact guard its own
  // page.tsx runs, rather than gating the whole section on isSuperAdmin. A
  // custom role granted only e.g. USER:READ now actually sees a link to the
  // one admin page it can reach, instead of the entire Admin section being
  // invisible regardless of its own grants.
  const adminNavVisibility: Record<string, boolean> = {
    "/admin/users": canViewUsers,
    "/admin/roles": canViewRoles,
    "/admin/custom-fields": canViewCustomFields,
    "/admin/communication-templates": canViewCommunicationTemplates,
    "/admin/interview-reminders": canViewOrganizationSettings,
    "/admin/offer-settings": canViewOrganizationSettings,
    // Mirrors admin/approval-chains/page.tsx's own redirect condition
    // exactly (JOB:READ or OFFER:READ) — showJobsNav/canViewOfferReports
    // already answer both halves.
    "/admin/approval-chains": showJobsNav || canViewOfferReports,
    "/admin/data-retention": canViewOrganizationSettings,
    "/admin/audit-log": canViewAuditLog,
  };

  return (
    <div className="flex h-svh">
      <AppSidebar
        adminNavVisibility={adminNavVisibility}
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
