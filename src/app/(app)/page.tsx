import Link from "next/link";

import { getSessionContext } from "@/lib/authz/session-context";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import {
  adminNav,
  applicationsNavItem,
  candidatesNavItem,
  dashboardsNavItem,
  interviewsNavItem,
  jobsNavItem,
  reportsNavItem,
  workflowsNavItem,
  type NavItem,
} from "@/config/nav";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MODULE_DESCRIPTIONS: Record<string, string> = {
  [jobsNavItem.href]: "Manage job requisitions and postings",
  [candidatesNavItem.href]: "Browse and manage the candidate database",
  [applicationsNavItem.href]: "Track candidates through the pipeline",
  [interviewsNavItem.href]: "View and schedule interviews",
  [reportsNavItem.href]: "Recruiting metrics and reports",
  [workflowsNavItem.href]: "Automation rules and triggers",
  [dashboardsNavItem.href]: "Custom dashboards and widgets",
};

function NavCard({ item }: { item: NavItem }) {
  return (
    <Link href={item.href}>
      <Card className="transition-colors hover:bg-accent/50">
        <CardHeader>
          <item.icon className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">{item.title}</CardTitle>
          <CardDescription>{MODULE_DESCRIPTIONS[item.href] ?? "Manage from the admin area"}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const context = await getSessionContext();

  const [showJobsNav, showCandidatesNav, showApplicationsNav, showInterviewsNav, canViewOfferReports, showWorkflowsNav, showDashboardsNav] =
    context
      ? await Promise.all([
          can(context, ENTITY.JOB, "READ"),
          can(context, ENTITY.CANDIDATE, "READ"),
          can(context, ENTITY.APPLICATION, "READ"),
          can(context, ENTITY.INTERVIEW, "READ"),
          can(context, ENTITY.OFFER, "READ"),
          can(context, ENTITY.WORKFLOW_DEFINITION, "READ"),
          can(context, ENTITY.DASHBOARD, "READ"),
        ])
      : [false, false, false, false, false, false, false];
  const showReportsNav = showJobsNav || canViewOfferReports;

  const moduleCards: NavItem[] = [
    showJobsNav && jobsNavItem,
    showCandidatesNav && candidatesNavItem,
    showApplicationsNav && applicationsNavItem,
    showInterviewsNav && interviewsNavItem,
    showReportsNav && reportsNavItem,
    showWorkflowsNav && workflowsNavItem,
    showDashboardsNav && dashboardsNavItem,
  ].filter((item): item is NavItem => Boolean(item));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {context?.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">Jump back into your recruiting workspace.</p>
      </div>

      {moduleCards.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {moduleCards.map((item) => (
            <NavCard key={item.href} item={item} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have access to any recruiting modules yet. Contact your administrator if you
          believe this is a mistake.
        </p>
      )}

      {context?.isSuperAdmin ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Admin</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {adminNav.map((item) => (
              <NavCard key={item.href} item={item} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
