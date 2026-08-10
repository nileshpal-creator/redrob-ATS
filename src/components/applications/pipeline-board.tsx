"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn, getInitials } from "@/lib/utils";
import { MODULE_TEXT_CLASS, type ModuleKey } from "@/lib/module-colors";

export type BoardStage = { id: string; name: string };
export type BoardCard = {
  id: string;
  candidate: { id: string; name: string };
  owner: { name: string };
  stage: { id: string; name: string };
  /** Optional so this type stays usable anywhere a caller doesn't have it handy. */
  stageEnteredAt?: string;
};

// Stage identity isn't fixed (pipeline stages are user-defined per job), so
// columns cycle through the same module palette in a fixed order purely for
// visual distinction between columns — it doesn't mean "this column IS the
// Interviews module", just "column 3 looks different from column 4".
const STAGE_COLOR_CYCLE: ModuleKey[] = ["jobs", "candidates", "interviews", "offers", "handoff", "reporting", "workflows"];

// A card sitting in the same stage this long without moving is worth a
// second look — not a business rule, purely a dashboard-style visual cue.
const STALE_STAGE_DAYS = 14;

function daysInStage(stageEnteredAt?: string) {
  if (!stageEnteredAt) return null;
  return Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * The one place @dnd-kit/core is imported (Phase 4 constraint: "keep
 * drag-and-drop isolated behind reusable components"). This component owns
 * only the drag mechanics — it reports a drop via `onDropCard` and renders
 * whatever `applications`/`stages` it's given; the caller (job-pipeline-
 * client.tsx) owns the optimistic-update-with-rollback state, so this stays
 * a plain, swappable presentation layer.
 */
function DraggableCard({ card }: { card: BoardCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const days = daysInStage(card.stageEnteredAt);
  const isStale = days !== null && days >= STALE_STAGE_DAYS;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "flex cursor-grab touch-none items-start gap-2 rounded-md border bg-card p-2 text-sm shadow-sm transition-shadow motion-safe:duration-150 active:cursor-grabbing hover:shadow-md",
        isDragging && "opacity-50",
      )}
    >
      <Avatar className="mt-0.5 size-7 shrink-0">
        <AvatarFallback className="text-[10px]">{getInitials(card.candidate.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <Link
          href={`/applications/${card.id}`}
          className="block truncate font-medium hover:underline"
          onClick={(event) => isDragging && event.preventDefault()}
        >
          {card.candidate.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{card.owner.name}</p>
        {days !== null ? (
          <p
            className={cn(
              "mt-1 flex items-center gap-1 text-[11px]",
              isStale ? "font-medium text-attention" : "text-muted-foreground/70",
            )}
          >
            {isStale ? <AlertTriangle className="size-3" /> : null}
            {days === 0 ? "Entered today" : `${days}d in stage`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DroppableColumn({ stage, cards, colorModule }: { stage: BoardStage; cards: BoardCard[]; colorModule: ModuleKey }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const staleCount = cards.filter((card) => {
    const days = daysInStage(card.stageEnteredAt);
    return days !== null && days >= STALE_STAGE_DAYS;
  }).length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-md border-t-2 border-x border-b bg-muted/30 p-2 transition-all motion-safe:duration-150",
        isOver && "ring-2 ring-primary",
      )}
      style={{ borderTopColor: `var(--module-${colorModule})` }}
    >
      <div className="flex items-center justify-between px-1">
        <p className={cn("text-sm font-semibold", MODULE_TEXT_CLASS[colorModule])}>{stage.name}</p>
        <div className="flex items-center gap-1">
          {staleCount > 0 ? (
            <span title={`${staleCount} card${staleCount === 1 ? "" : "s"} stuck ${STALE_STAGE_DAYS}+ days`}>
              <Badge variant="attention" className="gap-1">
                <AlertTriangle className="size-3" /> {staleCount}
              </Badge>
            </span>
          ) : null}
          <Badge variant="secondary">{cards.length}</Badge>
        </div>
      </div>
      <div className="flex min-h-16 flex-col gap-2">
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

export function PipelineBoard({
  stages,
  applications,
  onDropCard,
}: {
  stages: BoardStage[];
  applications: BoardCard[];
  onDropCard: (applicationId: string, toStageId: string) => void;
}) {
  // PointerSensor for mouse/touch drag, KeyboardSensor so a focused card can
  // be picked up/moved/dropped with Space + arrow keys + Space, per the
  // Phase 4 accessibility constraint.
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const applicationId = String(active.id);
    const toStageId = String(over.id);
    const current = applications.find((application) => application.id === applicationId);
    if (!current || current.stage.id === toStageId) return;
    onDropCard(applicationId, toStageId);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage, index) => (
          <DroppableColumn
            key={stage.id}
            stage={stage}
            cards={applications.filter((application) => application.stage.id === stage.id)}
            colorModule={STAGE_COLOR_CYCLE[index % STAGE_COLOR_CYCLE.length]}
          />
        ))}
      </div>
    </DndContext>
  );
}
