"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef, type RowSelectionState } from "@tanstack/react-table";
import { KanbanSquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParentJobPicker } from "@/components/jobs/parent-job-picker";
import { BulkActionToolbar } from "@/components/applications/bulk-action-toolbar";

type ReasonOption = { id: string; label: string };

export type ApplicationRow = {
  id: string;
  version: number;
  outcome: "ACTIVE" | "REJECTED" | "WITHDRAWN";
  createdAt: string;
  stageEnteredAt: string;
  candidate: { id: string; name: string; phone: string; email: string | null; source: { label: string } | null };
  job: { id: string; title: string };
  stage: { id: string; name: string };
  owner: { id: string; name: string; email: string };
};

type ApplicationsResult = { applications: ApplicationRow[]; total: number; page: number; pageSize: number };

// Status-color legend (docs/design-system.md): success=green (still active
// in the pipeline), neutral=gray (withdrawn — no company decision either
// way), destructive=red (rejected).
const OUTCOME_BADGE_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  ACTIVE: "success",
  REJECTED: "destructive",
  WITHDRAWN: "secondary",
};

export function ApplicationsClient({
  initialResult,
  rejectionReasons,
  canCreate,
}: {
  initialResult: ApplicationsResult;
  rejectionReasons: ReasonOption[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState(initialResult);
  const [filters, setFilters] = useState({ q: "", outcome: "", jobId: "" });
  const [job, setJob] = useState<{ id: string; title: string } | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isPending, startTransition] = useTransition();

  function fetchPage(page: number) {
    const params = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/applications?${params.toString()}`);
        if (response.ok) {
          setResult(await response.json());
          setRowSelection({});
        } else {
          toast.error("Failed to load applications. Please try again.");
        }
      } catch {
        toast.error("Failed to load applications. Please try again.");
      }
    });
  }

  const selectedRows = result.applications.filter((application) => rowSelection[application.id]);

  const columns: ColumnDef<ApplicationRow, unknown>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          aria-label={`Select application for ${row.original.candidate.name}`}
        />
      ),
    },
    {
      id: "candidate",
      header: "Candidate",
      accessorFn: (row) => row.candidate.name,
      cell: ({ row }) => (
        <Link href={`/candidates/${row.original.candidate.id}`} className="font-medium hover:underline">
          {row.original.candidate.name}
        </Link>
      ),
    },
    {
      header: "Job",
      cell: ({ row }) => (
        <Link href={`/jobs/${row.original.job.id}`} className="hover:underline">
          {row.original.job.title}
        </Link>
      ),
    },
    {
      header: "Source",
      cell: ({ row }) => row.original.candidate.source?.label ?? "—",
    },
    { header: "Stage", cell: ({ row }) => row.original.stage.name },
    {
      header: "Outcome",
      accessorKey: "outcome",
      cell: ({ row }) => (
        <Badge variant={OUTCOME_BADGE_VARIANT[row.original.outcome]}>{row.original.outcome}</Badge>
      ),
    },
    { header: "Owner", cell: ({ row }) => row.original.owner.name },
    {
      header: "In stage since",
      accessorKey: "stageEnteredAt",
      cell: ({ row }) => new Date(row.original.stageEnteredAt).toLocaleDateString(),
    },
    {
      id: "view",
      cell: ({ row }) => (
        <Link href={`/applications/${row.original.id}`} className="text-sm text-muted-foreground hover:underline">
          View
        </Link>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasActiveFilters = filters.q !== "" || filters.outcome !== "" || filters.jobId !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar>
          <Input
            placeholder="Search candidate name…"
            className="w-52"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            onKeyDown={(event) => event.key === "Enter" && fetchPage(1)}
          />
          <Select
            value={filters.outcome || "ANY"}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, outcome: value === "ANY" ? "" : value }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Outcome" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any outcome</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
          <div className="w-56">
            <ParentJobPicker
              value={job}
              onChange={(next) => {
                setJob(next);
                setFilters((prev) => ({ ...prev, jobId: next?.id ?? "" }));
              }}
            />
          </div>
          <Button variant="outline" onClick={() => fetchPage(1)} disabled={isPending}>
            Filter
          </Button>
          {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </FilterBar>
        {canCreate ? (
          <Button onClick={() => router.push("/applications/new")}>
            <Plus /> New application
          </Button>
        ) : null}
      </div>

      <BulkActionToolbar
        selectedRows={selectedRows}
        rejectionReasons={rejectionReasons}
        onDone={() => fetchPage(result.page)}
      />

      <DataTable
        columns={columns}
        data={result.applications}
        emptyMessage={
          hasActiveFilters ? (
            <EmptyState
              icon={KanbanSquare}
              title="No applications match these filters."
              description="Try adjusting or clearing your filters."
              size="sm"
            />
          ) : (
            <EmptyState
              icon={KanbanSquare}
              title="No applications yet"
              description="Applications appear here once a candidate is added to a job's pipeline."
              action={canCreate ? { label: "New application", onClick: () => router.push("/applications/new") } : undefined}
            />
          )
        }
        getRowId={(row) => row.id}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        isLoading={isPending}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {result.page} of {totalPages} &middot; {result.total} applications
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
