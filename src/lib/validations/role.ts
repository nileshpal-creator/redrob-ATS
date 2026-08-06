import { z } from "zod";

export const roleSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  description: z.string().max(500).optional(),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const roleUpdateSchema = roleSchema.partial();
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

const permissionGrantSchema = z.object({
  resource: z.string().min(1),
  action: z.enum(["CREATE", "READ", "UPDATE", "DELETE"]),
  scope: z.enum(["OWN", "TEAM", "ALL"]),
});

const fieldPermissionSchema = z.object({
  resource: z.string().min(1),
  field: z.string().min(1),
  access: z.enum(["HIDDEN", "READ", "WRITE"]),
});

export const rolePermissionsUpdateSchema = z.object({
  permissions: z.array(permissionGrantSchema),
  fieldPermissions: z.array(fieldPermissionSchema).default([]),
});
export type RolePermissionsUpdateInput = z.infer<typeof rolePermissionsUpdateSchema>;
