
/**
 * @fileoverview
 * This component renders a droppable zone that appears as a horizontal line
 * between tree nodes during a drag-and-drop operation. It provides a visual
 * target for reordering nodes as siblings.
 */
"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

interface TreeNodeDropZoneProps {
  id: string;
  className?: string;
}

export function TreeNodeDropZone({ id, className }: TreeNodeDropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  // This dropzone is a thin, invisible line by default.
  // When a draggable item is over it (`isOver`), it becomes a visible blue line.
  // We also make the final dropzone at the end of a list of children a bit taller
  // to make it easier to drop items at the end.
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-0 -my-0.5 rounded-full transition-all", // Collapsed by default with negative margin
        isOver ? "bg-primary opacity-100 h-1" : "opacity-0", // Expand and show when hovered over
        // Make last dropzone in a list of children a bit bigger for easier targeting
        id.includes('gap_end_') && 'h-2 -mb-2', 
        className
      )}
    />
  );
}
