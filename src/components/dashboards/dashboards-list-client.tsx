"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

async function requestJson(url: string, init: RequestInit = {}) {
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

export type DashboardRow = {
  id: string;
  name: string;
  description: string | null;
  createdBy: { name: string };
  createdAt: string;
};

function CreateDashboardDialog({ onCreated }: { onCreated: (dashboard: DashboardRow) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const created = await requestJson("/api/dashboards", {
        method: "POST",
        body: JSON.stringify({ name, description: description || undefined }),
      });
      onCreated(created);
      toast.success("Dashboard created.");
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/dashboards/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create dashboard");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New dashboard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
          <DialogDescription>Add widgets once it&apos;s created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DashboardsListClient({
  dashboards,
  canCreate,
}: {
  dashboards: DashboardRow[];
  canCreate: boolean;
}) {
  const [rows, setRows] = useState(dashboards);

  const columns: ColumnDef<DashboardRow, unknown>[] = [
    {
      header: "Name",
      cell: ({ row }) => (
        <Link href={`/dashboards/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      header: "Description",
      cell: ({ row }) => row.original.description ?? <span className="text-muted-foreground">—</span>,
    },
    { header: "Created by", cell: ({ row }) => row.original.createdBy.name },
    {
      header: "Created",
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <CreateDashboardDialog onCreated={(dashboard) => setRows((prev) => [dashboard, ...prev])} />
        </div>
      ) : null}
      <DataTable columns={columns} data={rows} emptyMessage="No dashboards yet." />
    </div>
  );
}
