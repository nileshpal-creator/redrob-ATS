"use client";

import { useState, useTransition } from "react";
import { type ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string | Date;
  actor: { id: string; name: string; email: string } | null;
};

type AuditResult = {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

export function AuditLogClient({ initialResult }: { initialResult: AuditResult }) {
  const [result, setResult] = useState(initialResult);
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [isPending, startTransition] = useTransition();

  function fetchPage(page: number) {
    const params = new URLSearchParams({ page: String(page) });
    if (entityType) params.set("entityType", entityType);
    if (entityId) params.set("entityId", entityId);

    startTransition(async () => {
      const response = await fetch(`/api/audit-log?${params.toString()}`);
      if (response.ok) {
        setResult(await response.json());
      }
    });
  }

  const columns: ColumnDef<AuditEntry, unknown>[] = [
    {
      header: "When",
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
    },
    {
      header: "Actor",
      cell: ({ row }) => row.original.actor?.name ?? "System",
    },
    { header: "Action", accessorKey: "action" },
    { header: "Entity", accessorKey: "entityType" },
    { header: "Entity ID", accessorKey: "entityId" },
  ];

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-sm font-medium">Entity type</label>
          <Input
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            placeholder="e.g. ROLE"
            className="w-48"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Entity ID</label>
          <Input
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            className="w-56"
          />
        </div>
        <Button variant="outline" onClick={() => fetchPage(1)} disabled={isPending}>
          Filter
        </Button>
      </div>

      <DataTable columns={columns} data={result.entries} emptyMessage="No activity recorded yet." />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {result.page} of {totalPages} &middot; {result.total} entries
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={result.page <= 1 || isPending}
            onClick={() => fetchPage(result.page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={result.page >= totalPages || isPending}
            onClick={() => fetchPage(result.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
