import type { AppNavVisibility } from "@/components/layout/app-sidebar";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector for the element to spotlight, or null for a centered card (the welcome step, or a target that isn't in the DOM). */
  selector: string | null;
};

/**
 * Steps are filtered by the same nav-visibility booleans the sidebar itself
 * uses (see (app)/layout.tsx), so the tour never points at a nav item a
 * given user's permissions actually hide.
 */
export function buildOnboardingSteps(nav: AppNavVisibility): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      title: "Welcome to Redrob ATS",
      body: "Here's a quick tour of where things live. Skip anytime — this won't show again once you're done.",
      selector: null,
    },
    {
      id: "nav-dashboard",
      title: "Dashboard",
      body: "Your home base — a snapshot of what needs your attention today.",
      selector: '[data-tour="nav-/"]',
    },
    {
      id: "nav-tasks",
      title: "My Tasks",
      body: "Approvals, reminders, and workflow steps assigned to you land here.",
      selector: '[data-tour="nav-/tasks"]',
    },
  ];

  if (nav.showJobsNav) {
    steps.push({
      id: "nav-jobs",
      title: "Jobs",
      body: "Create open roles and track each one's hiring pipeline.",
      selector: '[data-tour="nav-/jobs"]',
    });
  }
  if (nav.showCandidatesNav) {
    steps.push({
      id: "nav-candidates",
      title: "Candidates",
      body: "Search, add, and manage every candidate in your organization's talent pool.",
      selector: '[data-tour="nav-/candidates"]',
    });
  }
  if (nav.showApplicationsNav) {
    steps.push({
      id: "nav-applications",
      title: "Applications",
      body: "See exactly where each candidate stands in a job's pipeline, and move them forward.",
      selector: '[data-tour="nav-/applications"]',
    });
  }
  if (nav.showInterviewsNav) {
    steps.push({
      id: "nav-interviews",
      title: "Interview Calendar",
      body: "A calendar view of every scheduled interview, so panels never double-book.",
      selector: '[data-tour="nav-/interviews"]',
    });
  }
  if (nav.showReportsNav) {
    steps.push({
      id: "nav-reports",
      title: "Reports",
      body: "Pipeline funnels, time-to-fill, and recruiter productivity, all in one place.",
      selector: '[data-tour="nav-/reports"]',
    });
  }
  if (nav.showWorkflowsNav) {
    steps.push({
      id: "nav-workflows",
      title: "Workflows",
      body: "Define automated multi-step approval and notification workflows.",
      selector: '[data-tour="nav-/admin/workflows"]',
    });
  }
  if (nav.showDashboardsNav) {
    steps.push({
      id: "nav-dashboards",
      title: "Dashboards",
      body: "Build custom dashboards from the metrics that matter to your team.",
      selector: '[data-tour="nav-/dashboards"]',
    });
  }
  if (Object.values(nav.adminNavVisibility).some(Boolean)) {
    steps.push({
      id: "nav-admin",
      title: "Admin",
      body: "Configure roles, custom fields, communication templates, and other org-wide settings here.",
      selector: '[data-tour="nav-admin-section"]',
    });
  }

  steps.push({
    id: "user-menu",
    title: "Your account",
    body: "Manage your profile, change your password, or sign out from here.",
    selector: '[data-tour="user-menu"]',
  });

  return steps;
}
