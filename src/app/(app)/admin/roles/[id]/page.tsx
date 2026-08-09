import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY, ENTITY_LABELS } from "@/lib/entity-registry";
import { BackLink } from "@/components/layout/back-link";
import { RolePermissionEditor } from "@/components/admin/role-permission-editor";

export default async function RolePermissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.ROLE, "READ");

  const role = await prisma.role.findUnique({
    where: { id },
    include: { rolePermissions: true, fieldPermissions: true },
  });
  if (!role) {
    notFound();
  }

  const resources = Object.entries(ENTITY_LABELS).map(([resource, label]) => ({
    resource,
    label,
  }));

  return (
    <div className="space-y-4">
      <BackLink href="/admin/roles" label="Roles" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{role.name}</h1>
        <p className="text-muted-foreground">
          {role.isSuperAdmin
            ? "This role bypasses all permission checks and always has full access."
            : "Choose the scope each action is allowed at. Leaving a cell as “No access” denies it, even if the UI doesn't hide the button."}
        </p>
      </div>
      <RolePermissionEditor
        roleId={role.id}
        isSuperAdmin={role.isSuperAdmin}
        resources={resources}
        initialGrants={role.rolePermissions.map((grant) => ({
          resource: grant.resource,
          action: grant.action,
          scope: grant.scope,
        }))}
        fieldPermissions={role.fieldPermissions.map((rule) => ({
          resource: rule.resource,
          field: rule.field,
          access: rule.access,
        }))}
      />
    </div>
  );
}
