"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Briefcase, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type ListValue = { id: string; label: string };

type JobRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  employmentType: string;
  positionsCount: number;
  positionsFilledCount: number;
  createdAt: string;
  department: { label: string };
  location: { label: string };
  primaryRecruiter: { name: string };
};

type JobsResult = { jobs: JobRow[]; total: number; page: number; pageSize: number };

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "OPEN", "ON_HOLD", "CLOSED", "CANCELLED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// Status-color legend (docs/design-system.md): success=green (open),
// warning=amber (pending an internal decision), attention=orange (on hold —
// distinct from "pending approval", both read as caution but mean different
// things), neutral=gray, destructive=red (cancelled).
const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "attention" | "destructive"
> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  OPEN: "success",
  ON_HOLD: "attention",
  CLOSED: "secondary",
  CANCELLED: "destructive",
};

function agingLabel(createdAt: string) {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  return days <= 0 ? "Today" : `${days}d`;
}

export function JobsClient({
  initialResult,
  departments,
  locations,
  canCreate,
}: {
  initialResult: JobsResult;
  departments: ListValue[];
  locations: ListValue[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState(initialResult);
  const [filters, setFilters] = useState({ status: "", departmentId: "", locationId: "", priority: "", q: "" });
  const [isPending, startTransition] = useTransition();

  function fetchPage(page: number) {
    const params = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/jobs?${params.toString()}`);
        if (response.ok) {
          setResult(await response.json());
        } else {
          toast.error("Failed to load jobs. Please try again.");
        }
      } catch {
        toast.error("Failed to load jobs. Please try again.");
      }
    });
  }

  const columns: ColumnDef<JobRow, unknown>[] = [
    {
      header: "Title",
      accessorKey: "title",
      cell: ({ row }) => (
        <Link href={`/jobs/${row.original.id}`} className="font-medium hover:underline">
          {row.original.title}
        </Link>
      ),
    },
    { header: "Department", cell: ({ row }) => row.original.department.label },
    { header: "Location", cell: ({ row }) => row.original.location.label },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.original.status] ?? "default"}>
          {row.original.status.replace("_", " ")}
        </Badge>
      ),
    },
    { header: "Priority", accessorKey: "priority" },
    {
      header: "Positions",
      cell: ({ row }) => `${row.original.positionsFilledCount} / ${row.original.positionsCount}`,
    },
    { header: "Recruiter", cell: ({ row }) => row.original.primaryRecruiter.name },
    {
      header: "Age",
      accessorKey: "createdAt",
      cell: ({ row }) => agingLabel(row.original.createdAt),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar>
          <Input
            placeholder="Search title…"
            className="w-48"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            onKeyDown={(event) => event.key === "Enter" && fetchPage(1)}
          />
          <Select
            value={filters.status || "ANY"}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value === "ANY" ? "" : value }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any status</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.departmentId || "ANY"}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, departmentId: value === "ANY" ? "" : value }))}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any department</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.locationId || "ANY"}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, locationId: value === "ANY" ? "" : value }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any location</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.priority || "ANY"}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, priority: value === "ANY" ? "" : value }))}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any priority</SelectItem>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => fetchPage(1)} disabled={isPending}>
            Filter
          </Button>
          {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </FilterBar>
        {canCreate ? (
          <Button onClick={() => router.push("/jobs/new")}>
            <Plus /> New job
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={result.jobs}
        emptyMessage={
          hasActiveFilters ? (
            <EmptyState
              icon={Briefcase}
              title="No jobs match these filters."
              description="Try adjusting or clearing your filters."
              size="sm"
            />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No jobs yet"
              description="Jobs will appear here once you create one."
              action={canCreate ? { label: "New job", onClick: () => router.push("/jobs/new") } : undefined}
            />
          )
        }
        isLoading={isPending}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {result.page} of {totalPages} &middot; {result.total} jobs
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
