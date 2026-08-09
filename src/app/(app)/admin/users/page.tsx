import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { listUsers } from "@/lib/services/users";
import { listRoles } from "@/lib/services/roles";
import { UsersClient } from "@/components/admin/users-client";

export default async function UsersPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.USER, "READ");

  // listRoles needs ROLE:READ — a separate grant from this page's own
  // USER:READ gate (Recruiter/Hiring Manager/Recruiting Manager all get
  // USER:READ by default per prisma/seed.ts's DIRECTORY_ROLE_PERMISSIONS,
  // to see a directory of colleagues, but none get ROLE:READ). Only used
  // here to populate the Add User dialog's role picker, so a viewer who
  // lacks it still gets a working page — same fallback approval-chains/
  // page.tsx already uses for its own listRoles call.
  const [users, roles] = await Promise.all([listUsers(context), listRoles(context).catch(() => [])]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground">
          Create accounts and assign roles. Role grants determine what each user can see and do.
        </p>
      </div>
      <UsersClient
        initialUsers={users}
        roles={roles.map((role) => ({ id: role.id, name: role.name }))}
        currentUserId={context.userId}
        canDelete={context.isSuperAdmin}
      />
    </div>
  );
}
