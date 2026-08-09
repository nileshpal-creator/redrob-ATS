"use client";

import {
  type ColumnDef,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
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
 * applications). Sorting/filtering/pagination are added by passing the
 * corresponding table state + row models in from the caller — this
 * component only owns rendering.
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
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    enableRowSelection: Boolean(onRowSelectionChange),
    state: rowSelection ? { rowSelection } : undefined,
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
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
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
