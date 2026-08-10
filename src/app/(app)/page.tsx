import Link from "next/link";
import { Briefcase, CalendarClock, CheckSquare, LayoutGrid, Wallet } from "lucide-react";

import { getSessionContext } from "@/lib/authz/session-context";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getDashboardOverview } from "@/lib/services/dashboard-overview";
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
import { EmptyState } from "@/components/ui/empty-state";
import { IconBadge } from "@/components/ui/icon-badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AttentionPanel, type AttentionRow } from "@/components/dashboard/attention-panel";
import { NAV_HREF_MODULE, type ModuleKey } from "@/lib/module-colors";

const MODULE_DESCRIPTIONS: Record<string, string> = {
  [jobsNavItem.href]: "Manage job requisitions and postings",
  [candidatesNavItem.href]: "Browse and manage the candidate database",
  [applicationsNavItem.href]: "Track candidates through the pipeline",
  [interviewsNavItem.href]: "View and schedule interviews",
  [reportsNavItem.href]: "Recruiting metrics and reports",
  [workflowsNavItem.href]: "Automation rules and triggers",
  [dashboardsNavItem.href]: "Custom dashboards and widgets",
};

// Applications isn't one of the seven named modules (docs/design-system.md)
// but its dashboard card should still read as "part of the candidate
// pipeline" rather than plain gray.
const EXTRA_NAV_MODULE: Record<string, ModuleKey> = { [applicationsNavItem.href]: "candidates" };

function NavCard({ item }: { item: NavItem }) {
  const navModule = NAV_HREF_MODULE[item.href] ?? EXTRA_NAV_MODULE[item.href];
  return (
    <Link href={item.href}>
      <Card className="transition-all motion-safe:duration-150 hover:border-foreground/20 hover:shadow-sm motion-safe:hover:-translate-y-0.5">
        <CardHeader>
          {navModule ? (
            <IconBadge module={navModule} icon={item.icon} className="mb-1" />
          ) : (
            <item.icon className="mb-1 size-5 text-muted-foreground" />
          )}
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

  const overview = context ? await getDashboardOverview(context) : null;

  const moduleCards: NavItem[] = [
    showJobsNav && jobsNavItem,
    showCandidatesNav && candidatesNavItem,
    showApplicationsNav && applicationsNavItem,
    showInterviewsNav && interviewsNavItem,
    showReportsNav && reportsNavItem,
    showWorkflowsNav && workflowsNavItem,
    showDashboardsNav && dashboardsNavItem,
  ].filter((item): item is NavItem => Boolean(item));

  const attentionItems: AttentionRow[] = [];
  if (overview) {
    if (overview.myOpenTasks > 0) {
      attentionItems.push({
        icon: CheckSquare,
        label: `${overview.myOpenTasks} open task${overview.myOpenTasks === 1 ? "" : "s"} assigned to you`,
        href: "/tasks",
        tone: "warning",
      });
    }
    if (overview.interviewsToday !== null && overview.interviewsToday > 0) {
      attentionItems.push({
        icon: CalendarClock,
        label: `${overview.interviewsToday} interview${overview.interviewsToday === 1 ? "" : "s"} scheduled today`,
        href: "/interviews",
        tone: "info",
      });
    }
    if (overview.offersAwaitingAction !== null && overview.offersAwaitingAction > 0) {
      attentionItems.push({
        icon: Wallet,
        label: `${overview.offersAwaitingAction} offer${overview.offersAwaitingAction === 1 ? "" : "s"} awaiting action`,
        href: "/reports",
        tone: "attention",
      });
    }
  }

  return (
    <div className="space-y-8">
      <div className="-m-6 mb-0 rounded-b-2xl bg-gradient-brand p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {context?.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening in your recruiting workspace.</p>
      </div>

      {overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overview.openJobs !== null ? (
            <KpiCard
              label="Open jobs"
              value={overview.openJobs}
              icon={<IconBadge module="jobs" icon={Briefcase} size="lg" />}
              href="/jobs"
            />
          ) : null}
          {overview.activePipeline !== null ? (
            <KpiCard
              label="Active pipeline"
              value={overview.activePipeline}
              icon={<IconBadge module="candidates" icon={LayoutGrid} size="lg" />}
              href="/applications"
            />
          ) : null}
          {overview.interviewsToday !== null ? (
            <KpiCard
              label="Interviews today"
              value={overview.interviewsToday}
              icon={<IconBadge module="interviews" icon={CalendarClock} size="lg" />}
              href="/interviews"
            />
          ) : null}
          {overview.offersAwaitingAction !== null ? (
            <KpiCard
              label="Offers awaiting action"
              value={overview.offersAwaitingAction}
              icon={<IconBadge module="offers" icon={Wallet} size="lg" />}
              href="/reports"
            />
          ) : null}
          <KpiCard
            label="My open tasks"
            value={overview.myOpenTasks}
            icon={<IconBadge module="workflows" icon={CheckSquare} size="lg" />}
            href="/tasks"
          />
        </div>
      ) : null}

      {overview ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Needs your attention</h2>
          <AttentionPanel items={attentionItems} />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Modules</h2>
        {moduleCards.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {moduleCards.map((item) => (
              <NavCard key={item.href} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={LayoutGrid}
            title="No modules available yet"
            description="You don't have access to any recruiting modules yet. Contact your administrator if you believe this is a mistake."
          />
        )}
      </div>

      {context?.isSuperAdmin ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Admin</h2>
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
