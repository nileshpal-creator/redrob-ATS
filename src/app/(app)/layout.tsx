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

  const [showJobsNav, showCandidatesNav] = await Promise.all([
    can(context, ENTITY.JOB, "READ"),
    can(context, ENTITY.CANDIDATE, "READ"),
  ]);

  return (
    <div className="flex h-svh">
      <AppSidebar
        showAdminNav={context.isSuperAdmin}
        showJobsNav={showJobsNav}
        showCandidatesNav={showCandidatesNav}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar name={context.name} email={context.email} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
