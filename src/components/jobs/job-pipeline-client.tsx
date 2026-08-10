"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef, type RowSelectionState } from "@tanstack/react-table";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkActionToolbar } from "@/components/applications/bulk-action-toolbar";
import { PipelineBoard, type BoardCard, type BoardStage } from "@/components/applications/pipeline-board";
import { PipelineStageEditor, type PipelineStageRow } from "@/components/jobs/pipeline-stage-editor";

type ReasonOption = { id: string; label: string };

export type PipelineApplicationRow = {
  id: string;
  version: number;
  outcome: "ACTIVE" | "REJECTED" | "WITHDRAWN";
  stageEnteredAt: string;
  candidate: { id: string; name: string };
  job: { id: string; title: string };
  stage: { id: string; name: string };
  owner: { id: string; name: string };
};

// Status-color legend (docs/design-system.md) — kept in sync with the same
// map in applications-client.tsx by hand (client components, no shared import).
const OUTCOME_BADGE_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  ACTIVE: "success",
  REJECTED: "destructive",
  WITHDRAWN: "secondary",
};

export function JobPipelineClient({
  jobId,
  initialApplications,
  initialStages,
  rejectionReasons,
  canManageStages,
}: {
  jobId: string;
  initialApplications: PipelineApplicationRow[];
  initialStages: PipelineStageRow[];
  rejectionReasons: ReasonOption[];
  canManageStages: boolean;
}) {
  const router = useRouter();
  const [applications, setApplications] = useState(initialApplications);
  const [stages, setStages] = useState(initialStages);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Re-sync from fresh server props after router.refresh() (bulk actions,
  // the stage editor) — the drag-and-drop path below manages its own
  // optimistic state directly and never needs this.
  useEffect(() => setApplications(initialApplications), [initialApplications]);
  useEffect(() => setStages(initialStages), [initialStages]);

  const activeStages: BoardStage[] = stages.filter((stage) => stage.isActive);
  const activeApplicationCountByStageId = applications
    .filter((application) => application.outcome === "ACTIVE")
    .reduce<Record<string, number>>((acc, application) => {
      acc[application.stage.id] = (acc[application.stage.id] ?? 0) + 1;
      return acc;
    }, {});

  async function handleDropCard(applicationId: string, toStageId: string) {
    const target = applications.find((application) => application.id === applicationId);
    const toStage = stages.find((stage) => stage.id === toStageId);
    if (!target || !toStage) return;
    // Snapshot only this card's prior stage, not the whole array — dragging
    // a second card while the first request is still in flight must not
    // let an unrelated, later-resolving failure roll back a different
    // card's already-confirmed move. Rollback/reconciliation below always
    // updates via a functional setState so it applies against whatever the
    // latest state is, not a stale full-array snapshot.
    const fromStage = target.stage;

    setApplications((prev) =>
      prev.map((application) =>
        application.id === applicationId ? { ...application, stage: { id: toStage.id, name: toStage.name } } : application,
      ),
    );

    try {
      const response = await fetch(`/api/applications/${applicationId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "STAGE_MOVE", version: target.version, toStageId }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to move stage");
      }
      setApplications((prev) =>
        prev.map((application) =>
          application.id === applicationId
            ? { ...application, version: body.version, stage: body.stage, stageEnteredAt: body.stageEnteredAt }
            : application,
        ),
      );
      toast.success(`Moved to ${toStage.name}.`);
    } catch (error) {
      setApplications((prev) =>
        prev.map((application) => (application.id === applicationId ? { ...application, stage: fromStage } : application)),
      );
      toast.error(error instanceof Error ? error.message : "Failed to move stage");
    }
  }

  const boardCards: BoardCard[] = applications
    .filter((application) => application.outcome === "ACTIVE")
    .map((application) => ({
      id: application.id,
      candidate: application.candidate,
      owner: application.owner,
      stage: application.stage,
      stageEnteredAt: application.stageEnteredAt,
    }));

  const selectedRows = applications.filter((application) => rowSelection[application.id]);

  const columns: ColumnDef<PipelineApplicationRow, unknown>[] = [
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
      header: "Candidate",
      cell: ({ row }) => (
        <Link href={`/candidates/${row.original.candidate.id}`} className="font-medium hover:underline">
          {row.original.candidate.name}
        </Link>
      ),
    },
    { header: "Stage", cell: ({ row }) => row.original.stage.name },
    {
      header: "Outcome",
      cell: ({ row }) => (
        <Badge variant={OUTCOME_BADGE_VARIANT[row.original.outcome]}>{row.original.outcome}</Badge>
      ),
    },
    { header: "Owner", cell: ({ row }) => row.original.owner.name },
    {
      header: "In stage since",
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {applications.length} application{applications.length === 1 ? "" : "s"}
        </p>
        {canManageStages ? (
          <PipelineStageEditor
            jobId={jobId}
            initialStages={stages}
            activeApplicationCountByStageId={activeApplicationCountByStageId}
          />
        ) : null}
      </div>

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>
        <TabsContent value="board">
          {activeStages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active pipeline stages configured.</p>
          ) : (
            <PipelineBoard stages={activeStages} applications={boardCards} onDropCard={handleDropCard} />
          )}
        </TabsContent>
        <TabsContent value="list" className="space-y-4">
          <BulkActionToolbar
            selectedRows={selectedRows.map((row) => ({ id: row.id, version: row.version, job: row.job }))}
            rejectionReasons={rejectionReasons}
            onDone={() => {
              setRowSelection({});
              router.refresh();
            }}
          />
          <DataTable
            columns={columns}
            data={applications}
            emptyMessage="No applications in this pipeline yet."
            getRowId={(row) => row.id}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
