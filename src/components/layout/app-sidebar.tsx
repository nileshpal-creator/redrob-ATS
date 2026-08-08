"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  adminNav,
  applicationsNavItem,
  candidatesNavItem,
  jobsNavItem,
  primaryNav,
  reportsNavItem,
  workflowsNavItem,
  type NavItem,
} from "@/config/nav";
import { cn } from "@/lib/utils";

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {item.title}
    </Link>
  );
}

export function AppSidebar({
  showAdminNav,
  showJobsNav,
  showCandidatesNav,
  showApplicationsNav,
  showReportsNav,
  showWorkflowsNav,
}: {
  showAdminNav: boolean;
  showJobsNav: boolean;
  showCandidatesNav: boolean;
  showApplicationsNav: boolean;
  showReportsNav: boolean;
  showWorkflowsNav: boolean;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <span className="text-sm font-semibold text-sidebar-foreground">Redrob ATS</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {primaryNav.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
        {showJobsNav ? <NavLink item={jobsNavItem} /> : null}
        {showCandidatesNav ? <NavLink item={candidatesNavItem} /> : null}
        {showApplicationsNav ? <NavLink item={applicationsNavItem} /> : null}
        {showReportsNav ? <NavLink item={reportsNavItem} /> : null}
        {showWorkflowsNav ? <NavLink item={workflowsNavItem} /> : null}

        {showAdminNav ? (
          <>
            <div className="mt-4 mb-1 px-3 text-xs font-semibold tracking-wide text-sidebar-foreground/50 uppercase">
              Admin
            </div>
            {adminNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </>
        ) : null}
      </nav>
    </aside>
  );
}
