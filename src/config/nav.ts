import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  Contact,
  KanbanSquare,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const primaryNav: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
];

/** Shown only when the viewer has JOB:READ — see (app)/layout.tsx. */
export const jobsNavItem: NavItem = { title: "Jobs", href: "/jobs", icon: Briefcase };

/** Shown only when the viewer has CANDIDATE:READ — see (app)/layout.tsx. */
export const candidatesNavItem: NavItem = { title: "Candidates", href: "/candidates", icon: Contact };

/** Shown only when the viewer has APPLICATION:READ — see (app)/layout.tsx. */
export const applicationsNavItem: NavItem = { title: "Applications", href: "/applications", icon: KanbanSquare };

/** Rendered only for super-admin roles — see AppSidebar. Every module adds its admin screens here. */
export const adminNav: NavItem[] = [
  { title: "Users", href: "/admin/users", icon: Users },
  { title: "Roles & Permissions", href: "/admin/roles", icon: ShieldCheck },
  { title: "Custom Fields", href: "/admin/custom-fields", icon: SlidersHorizontal },
  { title: "Audit Log", href: "/admin/audit-log", icon: ScrollText },
];
