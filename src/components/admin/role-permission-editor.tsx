"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getApplicableActions } from "@/lib/authz/resource-actions";
import { cn } from "@/lib/utils";

const ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE"] as const;
const SCOPES = [
  { value: "NONE", label: "No access" },
  { value: "OWN", label: "Own records" },
  { value: "TEAM", label: "Team records" },
  { value: "ALL", label: "All records" },
] as const;

type Grant = { resource: string; action: string; scope: string };
type FieldRule = { resource: string; field: string; access: string };

function gridKey(resource: string, action: string) {
  return `${resource}:${action}`;
}

export function RolePermissionEditor({
  roleId,
  isSuperAdmin,
  resources,
  initialGrants,
  fieldPermissions,
}: {
  roleId: string;
  isSuperAdmin: boolean;
  resources: { resource: string; label: string }[];
  initialGrants: Grant[];
  fieldPermissions: FieldRule[];
}) {
  const [grid, setGrid] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const grant of initialGrants) {
      initial[gridKey(grant.resource, grant.action)] = grant.scope;
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);

  function setScope(resource: string, action: string, scope: string) {
    setGrid((prev) => ({ ...prev, [gridKey(resource, action)]: scope }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const permissions = Object.entries(grid)
        .filter(([, scope]) => scope !== "NONE")
        .map(([key, scope]) => {
          const [resource, action] = key.split(":");
          return { resource, action, scope };
        });

      const response = await fetch(`/api/roles/${roleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions, fieldPermissions }),
      });

      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Failed to save permissions");
      }

      toast.success("Permissions saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Resource</TableHead>
              {ACTIONS.map((action) => (
                <TableHead key={action}>{action}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map(({ resource, label }) => {
              const applicableActions = new Set(getApplicableActions(resource));
              return (
                <TableRow key={resource}>
                  <TableCell className="font-medium">{label}</TableCell>
                  {ACTIONS.map((action) => {
                    const isApplicable = applicableActions.has(action);
                    return (
                      <TableCell key={action}>
                        <Select
                          disabled={isSuperAdmin || !isApplicable}
                          value={grid[gridKey(resource, action)] ?? "NONE"}
                          onValueChange={(value) => setScope(resource, action, value)}
                        >
                          <SelectTrigger
                            size="sm"
                            className={cn("w-36", !isApplicable && "opacity-40")}
                            title={isApplicable ? undefined : `${action} doesn't apply to ${label}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCOPES.map((scope) => (
                              <SelectItem key={scope.value} value={scope.value}>
                                {scope.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {!isSuperAdmin ? (
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save permissions
        </Button>
      ) : null}
    </div>
  );
}
