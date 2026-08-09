import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can } from "@/lib/authz/authorize";
import { canAccessAdminNavItem } from "@/lib/authz/admin-nav-permissions";
import { ENTITY } from "@/lib/entity-registry";
import { adminNav } from "@/config/nav";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { AppMobileNav } from "@/components/layout/app-mobile-nav";

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
    adminNavVisibilityEntries,
  ] = await Promise.all([
    can(context, ENTITY.JOB, "READ"),
    can(context, ENTITY.CANDIDATE, "READ"),
    can(context, ENTITY.APPLICATION, "READ"),
    can(context, ENTITY.INTERVIEW, "READ"),
    can(context, ENTITY.OFFER, "READ"),
    can(context, ENTITY.WORKFLOW_DEFINITION, "READ"),
    can(context, ENTITY.DASHBOARD, "READ"),
    // Sourced from ADMIN_NAV_PERMISSIONS (src/lib/authz/admin-nav-permissions.ts)
    // — the same resource/action each admin page.tsx's own guardPage call
    // requires — instead of a hand-written can() per item, so the sidebar
    // and each page's actual guard can never silently drift apart.
    Promise.all(
      adminNav.map(async (item) => [item.href, await canAccessAdminNavItem(context, item.href)] as const),
    ),
  ]);
  // Reports are reachable with either JOB:READ or OFFER:READ (see
  // src/app/(app)/reports/page.tsx) — showJobsNav already answers the first half.
  const showReportsNav = showJobsNav || canViewOfferReports;

  const adminNavVisibility: Record<string, boolean> = Object.fromEntries(adminNavVisibilityEntries);

  const navVisibility = {
    adminNavVisibility,
    showJobsNav,
    showCandidatesNav,
    showApplicationsNav,
    showInterviewsNav,
    showReportsNav,
    showWorkflowsNav,
    showDashboardsNav,
  };

  return (
    <div className="flex h-svh">
      <AppSidebar {...navVisibility} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar
          name={context.name}
          email={context.email}
          roleNames={context.roles.map((role) => role.name)}
          mobileNav={<AppMobileNav {...navVisibility} />}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
