import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BellRing,
  Briefcase,
  CalendarDays,
  CheckSquare,
  Contact,
  GitBranch,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Users,
  Workflow,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const primaryNav: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  // Any active user can be assigned a WorkflowTask (see assertWorkflowTaskAccess's
  // unconditional assignee path) regardless of their broader RBAC grants, so
  // "My Tasks" is unconditional too — not gated by a resource permission.
  { title: "My Tasks", href: "/tasks", icon: CheckSquare },
];

/** Shown only when the viewer has JOB:READ — see (app)/layout.tsx. */
export const jobsNavItem: NavItem = { title: "Jobs", href: "/jobs", icon: Briefcase };

/** Shown only when the viewer has CANDIDATE:READ — see (app)/layout.tsx. */
export const candidatesNavItem: NavItem = { title: "Candidates", href: "/candidates", icon: Contact };

/** Shown only when the viewer has APPLICATION:READ — see (app)/layout.tsx. */
export const applicationsNavItem: NavItem = { title: "Applications", href: "/applications", icon: KanbanSquare };

/** Shown only when the viewer has INTERVIEW:READ — see (app)/layout.tsx. */
export const interviewsNavItem: NavItem = { title: "Interview Calendar", href: "/interviews", icon: CalendarDays };

/** Shown only when the viewer has JOB:READ or OFFER:READ — see (app)/layout.tsx. */
export const reportsNavItem: NavItem = { title: "Reports", href: "/reports", icon: BarChart3 };

/** Shown only when the viewer has WORKFLOW_DEFINITION:READ — see (app)/layout.tsx. */
export const workflowsNavItem: NavItem = { title: "Workflows", href: "/admin/workflows", icon: Workflow };

/** Rendered only for super-admin roles — see AppSidebar. Every module adds its admin screens here. */
export const adminNav: NavItem[] = [
  { title: "Users", href: "/admin/users", icon: Users },
  { title: "Roles & Permissions", href: "/admin/roles", icon: ShieldCheck },
  { title: "Custom Fields", href: "/admin/custom-fields", icon: SlidersHorizontal },
  { title: "Communication Templates", href: "/admin/communication-templates", icon: Mail },
  { title: "Interview Reminders", href: "/admin/interview-reminders", icon: BellRing },
  { title: "Offer Settings", href: "/admin/offer-settings", icon: Timer },
  { title: "Approval Chains", href: "/admin/approval-chains", icon: GitBranch },
  { title: "Audit Log", href: "/admin/audit-log", icon: ScrollText },
];
