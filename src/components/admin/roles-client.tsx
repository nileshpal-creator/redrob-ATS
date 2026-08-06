"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Loader2, Plus, Settings2, Trash2 } from "lucide-react";

import { roleSchema, type RoleInput } from "@/lib/validations/role";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuperAdmin: boolean;
  userCount: number;
};

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function AddRoleDialog({ onCreated }: { onCreated: (role: RoleRow) => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<RoleInput>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: "", description: "" },
  });

  async function onSubmit(values: RoleInput) {
    try {
      const role = await requestJson("/api/roles", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onCreated({ ...role, userCount: 0 });
      toast.success(`Role "${role.name}" created.`);
      setOpen(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create role");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add role</DialogTitle>
          <DialogDescription>
            You&apos;ll configure permissions on the next screen.
          </DialogDescription>
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Create role
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesClient({ initialRoles }: { initialRoles: RoleRow[] }) {
  const [roles, setRoles] = useState(initialRoles);

  async function handleDelete(role: RoleRow) {
    try {
      await requestJson(`/api/roles/${role.id}`, { method: "DELETE" });
      setRoles((prev) => prev.filter((row) => row.id !== role.id));
      toast.success(`Role "${role.name}" deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete role");
    }
  }

  const columns: ColumnDef<RoleRow, unknown>[] = [
    {
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.isSuperAdmin ? <Badge>Super admin</Badge> : null}
          {row.original.isSystem ? <Badge variant="secondary">System</Badge> : null}
        </div>
      ),
    },
    {
      header: "Description",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.description ?? "—"}</span>
      ),
    },
    { header: "Users", accessorKey: "userCount" },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/roles/${row.original.id}`}>
              <Settings2 /> Permissions
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={row.original.isSystem || row.original.userCount > 0}
            onClick={() => handleDelete(row.original)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddRoleDialog onCreated={(role) => setRoles((prev) => [...prev, role])} />
      </div>
      <DataTable columns={columns} data={roles} emptyMessage="No roles yet." />
    </div>
  );
}
