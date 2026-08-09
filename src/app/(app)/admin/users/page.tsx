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

  const [users, roles] = await Promise.all([listUsers(context), listRoles(context)]);

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
