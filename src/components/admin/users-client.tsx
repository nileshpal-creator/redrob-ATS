"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { createUserSchema, type CreateUserInput } from "@/lib/validations/user";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type RoleOption = { id: string; name: string };
type UserRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | string | null;
  roles: { role: RoleOption }[];
};

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function AddUserDialog({
  roles,
  onCreated,
}: {
  roles: RoleOption[];
  onCreated: (user: UserRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", roleIds: [] },
  });

  async function onSubmit(values: CreateUserInput) {
    try {
      const user = await requestJson("/api/users", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onCreated(user);
      toast.success(`${user.name} was added.`);
      setOpen(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create user");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>They can sign in immediately with this password.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Temporary password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="roleIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Roles</FormLabel>
                  <div className="space-y-2 rounded-md border p-3">
                    {roles.map((role) => (
                      <label key={role.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.value.includes(role.id)}
                          onCheckedChange={(checked) => {
                            field.onChange(
                              checked
                                ? [...field.value, role.id]
                                : field.value.filter((id) => id !== role.id),
                            );
                          }}
                        />
                        {role.name}
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * User deletion is destructive and irreversible (unlike the Active switch's
 * deactivate toggle), so — unlike every other delete action in this app,
 * which is a bare button (see RolesClient) — this requires typing the
 * user's email to confirm. No AlertDialog primitive exists in this codebase
 * (grepped `src/components/ui`), so this reuses the plain Dialog primitive
 * every other modal here is built on rather than adding a new dependency.
 */
function DeleteUserDialog({ user, onDeleted }: { user: UserRow; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await requestJson(`/api/users/${user.id}`, { method: "DELETE" });
      toast.success(`${user.name} was deleted.`);
      setOpen(false);
      onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete user");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`Delete ${user.name}`}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {user.name}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the account and cannot be undone. Users with existing job,
            candidate, or audit history can&apos;t be deleted — deactivate them instead. Type{" "}
            <span className="font-medium text-foreground">{user.email}</span> to confirm.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={user.email}
          autoComplete="off"
        />
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={confirmText !== user.email || deleting}
            onClick={handleDelete}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersClient({
  initialUsers,
  roles,
  currentUserId,
  canDelete,
}: {
  initialUsers: UserRow[];
  roles: RoleOption[];
  currentUserId: string;
  canDelete: boolean;
}) {
  const [users, setUsers] = useState(initialUsers);

  async function toggleStatus(user: UserRow, isActive: boolean) {
    try {
      const updated = await requestJson(`/api/users/${user.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ isActive }),
      });
      setUsers((prev) => prev.map((row) => (row.id === user.id ? { ...row, ...updated } : row)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    }
  }

  const columns: ColumnDef<UserRow, unknown>[] = [
    { header: "Name", accessorKey: "name" },
    { header: "Email", accessorKey: "email" },
    {
      header: "Roles",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.roles.map(({ role }) => (
            <Badge key={role.id} variant="secondary">
              {role.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      header: "Active",
      cell: ({ row }) => (
        <Switch
          checked={row.original.isActive}
          onCheckedChange={(checked) => toggleStatus(row.original, checked)}
        />
      ),
    },
    {
      header: "Last login",
      cell: ({ row }) =>
        row.original.lastLoginAt
          ? new Date(row.original.lastLoginAt).toLocaleString()
          : "Never",
    },
  ];

  if (canDelete) {
    columns.push({
      header: "",
      id: "actions",
      cell: ({ row }) =>
        row.original.id === currentUserId ? null : (
          <div className="flex justify-end">
            <DeleteUserDialog
              user={row.original}
              onDeleted={() => setUsers((prev) => prev.filter((u) => u.id !== row.original.id))}
            />
          </div>
        ),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddUserDialog roles={roles} onCreated={(user) => setUsers((prev) => [...prev, user])} />
      </div>
      <DataTable columns={columns} data={users} emptyMessage="No users yet." />
    </div>
  );
}
