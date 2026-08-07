"use client";

import Link from "next/link";
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

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type BoardStage = { id: string; name: string };
export type BoardCard = {
  id: string;
  candidate: { id: string; name: string };
  owner: { name: string };
  stage: { id: string; name: string };
};

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab touch-none rounded-md border bg-background p-2 text-sm shadow-sm active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <Link
        href={`/applications/${card.id}`}
        className="font-medium hover:underline"
        onClick={(event) => isDragging && event.preventDefault()}
      >
        {card.candidate.name}
      </Link>
      <p className="text-xs text-muted-foreground">{card.owner.name}</p>
    </div>
  );
}

function DroppableColumn({ stage, cards }: { stage: BoardStage; cards: BoardCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-md border bg-muted/30 p-2",
        isOver && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold">{stage.name}</p>
        <Badge variant="secondary">{cards.length}</Badge>
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
        {stages.map((stage) => (
          <DroppableColumn
            key={stage.id}
            stage={stage}
            cards={applications.filter((application) => application.stage.id === stage.id)}
          />
        ))}
      </div>
    </DndContext>
  );
}
