"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";

const TRIGGER_LABEL: Record<string, string> = {
  STAGE_CHANGE: "Stage change",
  FIELD_UPDATE: "Field update",
  TIME_IN_STAGE: "Time in stage",
  FORM_SUBMISSION: "New application",
};

export type WorkflowRow = {
  id: string;
  name: string;
  isActive: boolean;
  job: { id: string; title: string } | null;
  activeVersion: { triggerType: string } | null;
  createdBy: { name: string };
};

export function WorkflowsListClient({ workflows, canCreate }: { workflows: WorkflowRow[]; canCreate: boolean }) {
  const columns: ColumnDef<WorkflowRow, unknown>[] = [
    {
      header: "Name",
      cell: ({ row }) => (
        <Link href={`/admin/workflows/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      header: "Applies to",
      cell: ({ row }) => row.original.job?.title ?? <span className="text-muted-foreground">Every job</span>,
    },
    {
      header: "Trigger",
      cell: ({ row }) =>
        row.original.activeVersion ? TRIGGER_LABEL[row.original.activeVersion.triggerType] ?? row.original.activeVersion.triggerType : "—",
    },
    { header: "Created by", cell: ({ row }) => row.original.createdBy.name },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "secondary" : "outline"}>
          {row.original.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link href="/admin/workflows/new">
              <Plus /> New workflow
            </Link>
          </Button>
        </div>
      ) : null}
      <DataTable columns={columns} data={workflows} emptyMessage="No workflows configured yet." />
    </div>
  );
}
