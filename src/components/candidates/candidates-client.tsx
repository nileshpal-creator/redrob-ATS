"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Download, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { TagInput } from "@/components/ui/tag-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ListValue = { id: string; label: string };

type CandidateRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  location: string | null;
  skills: string[];
  noticePeriodDays: number | null;
  source: { label: string } | null;
  createdAt: string;
};

type CandidatesResult = { candidates: CandidateRow[]; total: number; page: number; pageSize: number };

type Filters = {
  q: string;
  sourceId: string;
  location: string;
  skills: string[];
  tags: string[];
  noticePeriodMaxDays: string;
  experienceMinYears: string;
  compensationMaxExpected: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  sourceId: "",
  location: "",
  skills: [],
  tags: [],
  noticePeriodMaxDays: "",
  experienceMinYears: "",
  compensationMaxExpected: "",
};

function buildParams(filters: Filters, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  if (filters.q) params.set("q", filters.q);
  if (filters.sourceId) params.set("sourceId", filters.sourceId);
  if (filters.location) params.set("location", filters.location);
  if (filters.noticePeriodMaxDays) params.set("noticePeriodMaxDays", filters.noticePeriodMaxDays);
  if (filters.experienceMinYears) params.set("experienceMinYears", filters.experienceMinYears);
  if (filters.compensationMaxExpected) params.set("compensationMaxExpected", filters.compensationMaxExpected);
  for (const skill of filters.skills) params.append("skills", skill);
  for (const tag of filters.tags) params.append("tags", tag);
  return params;
}

export function CandidatesClient({
  initialResult,
  sources,
  canCreate,
}: {
  initialResult: CandidatesResult;
  sources: ListValue[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState(initialResult);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [isPending, startTransition] = useTransition();

  function fetchPage(page: number) {
    const params = buildParams(filters, page);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/candidates?${params.toString()}`);
        if (response.ok) {
          setResult(await response.json());
        } else {
          toast.error("Failed to load candidates. Please try again.");
        }
      } catch {
        toast.error("Failed to load candidates. Please try again.");
      }
    });
  }

  function exportAs(format: "csv" | "xlsx") {
    const params = buildParams(filters, 1);
    params.set("format", format);
    params.delete("page");
    window.location.href = `/api/candidates/export?${params.toString()}`;
  }

  const columns: ColumnDef<CandidateRow, unknown>[] = [
    {
      header: "Name",
      cell: ({ row }) => (
        <Link href={`/candidates/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { header: "Phone", cell: ({ row }) => row.original.phone },
    { header: "Email", cell: ({ row }) => row.original.email ?? "—" },
    { header: "Location", cell: ({ row }) => row.original.location ?? "—" },
    {
      header: "Skills",
      cell: ({ row }) => (
        <div className="flex max-w-56 flex-wrap gap-1">
          {row.original.skills.slice(0, 4).map((skill) => (
            <Badge key={skill} variant="secondary">
              {skill}
            </Badge>
          ))}
          {row.original.skills.length > 4 ? (
            <Badge variant="outline">+{row.original.skills.length - 4}</Badge>
          ) : null}
        </div>
      ),
    },
    { header: "Source", cell: ({ row }) => row.original.source?.label ?? "—" },
    {
      header: "Notice period",
      cell: ({ row }) => (row.original.noticePeriodDays !== null ? `${row.original.noticePeriodDays}d` : "—"),
    },
    {
      header: "Added",
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            placeholder="Search name, phone, email…"
            className="w-52"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            onKeyDown={(event) => event.key === "Enter" && fetchPage(1)}
          />
          <Select
            value={filters.sourceId || "ANY"}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, sourceId: value === "ANY" ? "" : value }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any source</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Location"
            className="w-36"
            value={filters.location}
            onChange={(event) => setFilters((prev) => ({ ...prev, location: event.target.value }))}
            onKeyDown={(event) => event.key === "Enter" && fetchPage(1)}
          />
          <Input
            type="number"
            placeholder="Min experience (yrs)"
            className="w-40"
            value={filters.experienceMinYears}
            onChange={(event) => setFilters((prev) => ({ ...prev, experienceMinYears: event.target.value }))}
          />
          <Input
            type="number"
            placeholder="Max notice (days)"
            className="w-36"
            value={filters.noticePeriodMaxDays}
            onChange={(event) => setFilters((prev) => ({ ...prev, noticePeriodMaxDays: event.target.value }))}
          />
          <Input
            type="number"
            placeholder="Max expected comp."
            className="w-40"
            value={filters.compensationMaxExpected}
            onChange={(event) => setFilters((prev) => ({ ...prev, compensationMaxExpected: event.target.value }))}
          />
          <div className="w-48">
            <TagInput
              value={filters.skills}
              onChange={(next) => setFilters((prev) => ({ ...prev, skills: next }))}
              placeholder="Skills…"
            />
          </div>
          <div className="w-48">
            <TagInput
              value={filters.tags}
              onChange={(next) => setFilters((prev) => ({ ...prev, tags: next }))}
              placeholder="Tags…"
            />
          </div>
          <Button variant="outline" onClick={() => fetchPage(1)} disabled={isPending}>
            Filter
          </Button>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => exportAs("csv")}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportAs("xlsx")}>Export as Excel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canCreate ? (
            <>
              <Button variant="outline" onClick={() => router.push("/candidates/import")}>
                <Upload /> Import
              </Button>
              <Button onClick={() => router.push("/candidates/new")}>
                <Plus /> New candidate
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <DataTable columns={columns} data={result.candidates} emptyMessage="No candidates match these filters." />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {result.page} of {totalPages} &middot; {result.total} candidates
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
