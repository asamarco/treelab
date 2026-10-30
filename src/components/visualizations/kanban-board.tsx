"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { Template, TreeNode } from "@/lib/types";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getConditionalStyle } from "@/components/tree/tree-node-utils";
import { formatCellValue } from "@/components/tree/query-field/format-cell-value";
import {
  KanbanBoardConfig,
  KanbanColumn,
  applyKanbanMove,
  buildKanbanColumns,
  findGroupByField,
  getKanbanCardFields,
  UNASSIGNED_COLUMN_KEY,
} from "@/lib/visualizations/kanban";
import { cn } from "@/lib/utils";

const CARDS_PER_COLUMN_STEP = 50;
const OPEN_CLICK_DELAY_MS = 250;

export interface KanbanBoardProps {
  onEditNode?: (nodeId: string) => void;
  nodes: TreeNode[];
  templates: Template[];
  config: KanbanBoardConfig;
  readOnly?: boolean;
  isCompact?: boolean;
  dateFormat?: string;
  onMoveNode?: (nodeId: string, patch: Record<string, string>) => void;
  onOpenNode?: (nodeId: string) => void;
}

export function KanbanBoard({
  nodes,
  templates,
  config,
  readOnly = false,
  isCompact = false,
  dateFormat,
  onMoveNode,
  onOpenNode,
  onEditNode,
}: KanbanBoardProps) {
  const dndContextId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const templateById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const { columns, issues } = useMemo(
    () => buildKanbanColumns(nodes, templates, config),
    [nodes, templates, config],
  );

  const moveNode = (nodeId: string, targetColumnKey: string) => {
    const node = nodeById.get(nodeId);
    if (!node || !onMoveNode) return;
    const patch = applyKanbanMove(node, templateById.get(node.templateId), config, targetColumnKey);
    if (patch) onMoveNode(nodeId, patch);
  };

  const menuColumnKeys = Array.from(new Set([...columns.map(c => c.key), UNASSIGNED_COLUMN_KEY]));
  const visibleColumns = columns.filter(
    c => c.key !== UNASSIGNED_COLUMN_KEY || c.nodes.length > 0 || activeNodeId !== null,
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveNodeId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveNodeId(null);
    if (!event.over) return;
    moveNode(String(event.active.id), String(event.over.id));
  };

  const activeNode = activeNodeId ? nodeById.get(activeNodeId) : undefined;
  const activeTemplate = activeNode ? templateById.get(activeNode.templateId) : undefined;
  const cardWidthClass = isCompact ? "w-44" : "w-64";
  const interactive = !readOnly && !!onMoveNode;

  return (
    <DndContext
      id={`${dndContextId}-kanban`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveNodeId(null)}
    >
      <div
        className="w-full min-w-0 mt-2"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex gap-2 overflow-x-auto pb-2">
          {visibleColumns.map(column => (
            <KanbanColumnView
              key={column.key}
              column={column}
              widthClass={cardWidthClass}
              isCompact={isCompact}
              dateFormat={dateFormat}
              config={config}
              templateById={templateById}
              droppable={interactive}
              columnKeys={menuColumnKeys}
              interactive={interactive}
              onOpenNode={onOpenNode}
              onEditNode={onEditNode}
              onMoveTo={moveNode}
            />
          ))}
        </div>
        {issues.length > 0 && (
          <p className={cn("text-muted-foreground mt-1", isCompact ? "text-[10px]" : "text-xs")}>
            {issues.length} {issues.length === 1 ? "node is" : "nodes are"} not shown because its template has no
            &quot;{config.groupByFieldName}&quot; dropdown field.
          </p>
        )}
      </div>
      <DragOverlay>
        {activeNode && (
          <div className="pointer-events-none">
            <KanbanCardBody
              node={activeNode}
              template={activeTemplate}
              config={config}
              isCompact={isCompact}
              dateFormat={dateFormat}
              widthClass={cardWidthClass}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface KanbanColumnViewProps {
  onEditNode?: (nodeId: string) => void;
  column: KanbanColumn;
  widthClass: string;
  isCompact: boolean;
  dateFormat?: string;
  config: KanbanBoardConfig;
  templateById: Map<string, Template>;
  droppable: boolean;
  columnKeys: string[];
  interactive: boolean;
  onOpenNode?: (nodeId: string) => void;
  onMoveTo: (nodeId: string, columnKey: string) => void;
}

function KanbanColumnView({
  column,
  widthClass,
  isCompact,
  dateFormat,
  config,
  templateById,
  droppable,
  columnKeys,
  interactive,
  onOpenNode,
  onEditNode,
  onMoveTo,
}: KanbanColumnViewProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !droppable });
  const [visibleCount, setVisibleCount] = useState(CARDS_PER_COLUMN_STEP);
  const visibleNodes = column.nodes.slice(0, visibleCount);
  const hiddenCount = column.nodes.length - visibleNodes.length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col flex-none rounded-md border bg-muted/40 p-2 gap-2 transition-colors",
        widthClass,
        isOver && "border-primary bg-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className={cn("font-semibold truncate", isCompact ? "text-xs" : "text-sm")}>{column.label}</span>
        <Badge variant="secondary" className="shrink-0">{column.nodes.length}</Badge>
      </div>
      {column.nodes.length === 0 && (
        <p className={cn("text-muted-foreground px-1 py-2", isCompact ? "text-[10px]" : "text-xs")}>No cards</p>
      )}
      {visibleNodes.map(node => (
        <KanbanCard
          key={node.id}
          node={node}
          template={templateById.get(node.templateId)}
          config={config}
          isCompact={isCompact}
          dateFormat={dateFormat}
          widthClass={widthClass}
          canMove={interactive && !!findGroupByField(templateById.get(node.templateId), config.groupByFieldName)}
          otherColumns={columnKeys.filter(k => k !== column.key)}
          onOpenNode={onOpenNode}
          onEditNode={onEditNode}
          onMoveTo={onMoveTo}
        />
      ))}
      {hiddenCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setVisibleCount(count => count + CARDS_PER_COLUMN_STEP)}
        >
          Show {Math.min(hiddenCount, CARDS_PER_COLUMN_STEP)} more
        </Button>
      )}
    </div>
  );
}

interface KanbanCardProps {
  onEditNode?: (nodeId: string) => void;
  node: TreeNode;
  template: Template | undefined;
  config: KanbanBoardConfig;
  isCompact: boolean;
  dateFormat?: string;
  widthClass: string;
  canMove: boolean;
  otherColumns: string[];
  onOpenNode?: (nodeId: string) => void;
  onMoveTo: (nodeId: string, columnKey: string) => void;
}

function KanbanCard({
  onEditNode,
  node,
  template,
  config,
  isCompact,
  dateFormat,
  widthClass,
  canMove,
  otherColumns,
  onOpenNode,
  onMoveTo,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: node.id,
    disabled: !canMove,
  });

  return (
    <div ref={setNodeRef} className={cn(widthClass, "flex-none", isDragging && "opacity-40")}>
      <KanbanCardBody
        node={node}
        template={template}
        config={config}
        isCompact={isCompact}
        dateFormat={dateFormat}
        onOpenNode={onOpenNode}
        onEditNode={onEditNode}
        handle={canMove ? (
          <Button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 cursor-grab touch-none"
            aria-label="Drag card"
          >
            <GripVertical className="h-4 w-4" />
          </Button>
        ) : null}
        menu={canMove ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="Move to">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {otherColumns.map(key => (
                <DropdownMenuItem key={key} onSelect={() => onMoveTo(node.id, key)}>
                  {key === UNASSIGNED_COLUMN_KEY ? "Unassign" : `Move to ${columnLabelFromKey(key)}`}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      />
    </div>
  );
}

function columnLabelFromKey(key: string): string {
  return key === "__unassigned__" ? "Unassigned" : key.slice(2);
}

interface KanbanCardBodyProps {
  onEditNode?: (nodeId: string) => void;
  node: TreeNode;
  template: Template | undefined;
  config: KanbanBoardConfig;
  isCompact: boolean;
  dateFormat?: string;
  widthClass?: string;
  onOpenNode?: (nodeId: string) => void;
  handle?: React.ReactNode;
  menu?: React.ReactNode;
}

function KanbanCardBody({
  onEditNode,
  node,
  template,
  config,
  isCompact,
  dateFormat,
  widthClass,
  onOpenNode,
  handle,
  menu,
}: KanbanCardBodyProps) {
  const { icon, color } = getConditionalStyle(node, template);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
  }, []);
  const fields = getKanbanCardFields(template, config).flatMap(field => {
    const value = formatCellValue(node, field, dateFormat);
    return value ? [{ id: field.id, name: field.name, value }] : [];
  });

  return (
    <div
      onDoubleClick={() => {
        if (openTimerRef.current) {
          clearTimeout(openTimerRef.current);
          openTimerRef.current = null;
        }
        onEditNode?.(node.id);
      }}
      className={cn(
        "rounded-md border bg-card text-card-foreground shadow-sm p-2 space-y-1.5",
        widthClass,
      )}
    >
      <div className="flex items-center gap-1">
        {handle}
        <Icon name={icon as any} className="h-4 w-4 shrink-0" style={{ color }} />
        <button
          type="button"
          className={cn("text-left font-medium truncate flex-1 min-w-0 hover:underline", isCompact ? "text-xs" : "text-sm")}
          onClick={() => {
            if (openTimerRef.current) clearTimeout(openTimerRef.current);
            openTimerRef.current = setTimeout(() => {
              openTimerRef.current = null;
              onOpenNode?.(node.id);
            }, OPEN_CLICK_DELAY_MS);
          }}
        >
          {node.name}
        </button>
        {menu}
      </div>
      {fields.map(field => (
        <div key={field.id} className={cn("text-muted-foreground truncate", isCompact ? "text-[10px]" : "text-xs")}>
          <span className="font-medium">{field.name}:</span> {field.value}
        </div>
      ))}
    </div>
  );
}
