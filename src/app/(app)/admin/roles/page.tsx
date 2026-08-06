import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { listRoles } from "@/lib/services/roles";
import { RolesClient } from "@/components/admin/roles-client";

export default async function RolesPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.ROLE, "READ");

  const roles = await listRoles(context);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles &amp; Permissions</h1>
        <p className="text-muted-foreground">
          Roles are not a fixed list — create as many as your org needs. Open a role to configure
          exactly what it can create, read, update, and delete.
        </p>
      </div>
      <RolesClient
        initialRoles={roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          isSuperAdmin: role.isSuperAdmin,
          userCount: role._count.users,
        }))}
      />
    </div>
  );
}
