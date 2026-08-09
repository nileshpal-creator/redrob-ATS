"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Thin wrapper around @tanstack/react-table for the list views every module
 * needs (users, roles, custom fields, audit log, jobs, candidates,
 * applications). Filtering/pagination are added by passing the corresponding
 * table state + row models in from the caller — this component only owns
 * rendering.
 *
 * Sorting is handled internally (client-side, over whatever `data` is passed
 * in — typically the current page) and only applies to columns with an
 * `accessorKey`/`accessorFn`; display-only columns (header/cell without an
 * accessor) are left unsortable automatically.
 *
 * Row selection (Module 4's bulk-action toolbars) is opt-in: pass
 * `getRowId` + `rowSelection` + `onRowSelectionChange` and include your own
 * "select" column in `columns` (a checkbox header/cell) — the same pattern
 * @tanstack/react-table itself uses. Callers that omit these props are
 * unaffected.
 */
export function DataTable<TData>({
  columns,
  data,
  emptyMessage = "No records found.",
  getRowId,
  rowSelection,
  onRowSelectionChange,
  isLoading = false,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  emptyMessage?: string;
  getRowId?: (row: TData) => string;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (next: RowSelectionState) => void;
  /** Dims the table while a refetch is in flight — data stays visible, just muted. */
  isLoading?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    enableRowSelection: Boolean(onRowSelectionChange),
    state: {
      sorting,
      ...(rowSelection ? { rowSelection } : {}),
    },
    onSortingChange: setSorting,
    onRowSelectionChange: onRowSelectionChange
      ? (updater) => {
          const next = typeof updater === "function" ? updater(rowSelection ?? {}) : updater;
          onRowSelectionChange(next);
        }
      : undefined,
  });

  return (
    <div
      className={cn("rounded-md border transition-opacity", isLoading && "opacity-60")}
      aria-busy={isLoading}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === "asc" ? (
                        <ArrowUp className="size-3.5" />
                      ) : header.column.getIsSorted() === "desc" ? (
                        <ArrowDown className="size-3.5" />
                      ) : (
                        <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                      )}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
