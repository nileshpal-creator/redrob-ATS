import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleIds: z.array(z.string()).min(1, "Assign at least one role"),
  managerId: z.string().optional().nullable(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserRolesSchema = z.object({
  roleIds: z.array(z.string()).min(1, "Assign at least one role"),
});
export type UpdateUserRolesInput = z.infer<typeof updateUserRolesSchema>;

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
