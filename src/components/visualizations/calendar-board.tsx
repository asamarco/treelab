"use client";

import React, { useId, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { addMonths, format, isSameMonth, isToday, startOfMonth, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, GripVertical, MoreHorizontal } from "lucide-react";
import { CalendarView, Template, TreeNode } from "@/lib/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar as DayPicker } from "@/components/ui/calendar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  NodeCardField,
  NodeCardFieldLines,
  NodeTitle,
  getNodeCardFields,
  useNodeOpenHandlers,
} from "@/components/visualizations/shared/node-card";
import {
  CalendarBoardConfig,
  applyCalendarMove,
  buildCalendarEvents,
  buildMonthGrid,
  dayKey,
  findCalendarDateField,
  getAgendaDays,
  getCalendarCardFields,
  parseDateFieldValue,
} from "@/lib/visualizations/calendar";
import { cn } from "@/lib/utils";

const MAX_EVENTS_PER_DAY = 3;
const DAY_TARGET_PREFIX = "day:";
const UNSCHEDULED_TARGET = "unscheduled";

const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

interface EventViewOptions {
  templateById: Map<string, Template>;
  config: CalendarBoardConfig;
  isCompact: boolean;
  dateFormat?: string;
  interactive: boolean;
  onOpenNode?: (nodeId: string) => void;
  onEditNode?: (nodeId: string) => void;
  onSetDay: (nodeId: string, targetDayKey: string | null) => void;
}

export interface CalendarBoardProps {
  nodes: TreeNode[];
  templates: Template[];
  config: CalendarBoardConfig;
  readOnly?: boolean;
  isCompact?: boolean;
  dateFormat?: string;
  onMoveNode?: (nodeId: string, patch: Record<string, string>) => void;
  onOpenNode?: (nodeId: string) => void;
  onEditNode?: (nodeId: string) => void;
}

export function CalendarBoard({
  nodes,
  templates,
  config,
  readOnly = false,
  isCompact = false,
  dateFormat,
  onMoveNode,
  onOpenNode,
  onEditNode,
}: CalendarBoardProps) {
  const dndContextId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const isMobile = useIsMobile();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [viewOverride, setViewOverride] = useState<CalendarView | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const view: CalendarView = viewOverride ?? (isMobile ? "agenda" : config.defaultView);
  const templateById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const { eventsByDay, unscheduled, issues } = useMemo(
    () => buildCalendarEvents(nodes, templates, config),
    [nodes, templates, config],
  );
  const interactive = !readOnly && !!onMoveNode;

  const setNodeDay = (nodeId: string, targetDayKey: string | null) => {
    const node = nodeById.get(nodeId);
    if (!node || !onMoveNode) return;
    const patch = applyCalendarMove(node, templateById.get(node.templateId), config, targetDayKey);
    if (patch) onMoveNode(nodeId, patch);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveNodeId(null);
    if (!event.over) return;
    const nodeId = String(event.active.id);
    const target = String(event.over.id);
    if (target === UNSCHEDULED_TARGET) {
      setNodeDay(nodeId, null);
    } else if (target.startsWith(DAY_TARGET_PREFIX)) {
      setNodeDay(nodeId, target.slice(DAY_TARGET_PREFIX.length));
    }
  };

  const options: EventViewOptions = {
    templateById,
    config,
    isCompact,
    dateFormat,
    interactive,
    onOpenNode,
    onEditNode,
    onSetDay: setNodeDay,
  };

  const activeNode = activeNodeId ? nodeById.get(activeNodeId) : undefined;
  const activeTemplate = activeNode ? templateById.get(activeNode.templateId) : undefined;
  const textSize = isCompact ? "text-[11px]" : "text-xs";

  return (
    <DndContext
      id={`${dndContextId}-calendar`}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(event: DragStartEvent) => setActiveNodeId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveNodeId(null)}
    >
      <div
        className="w-full min-w-0 mt-2 space-y-2"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Previous"
              onClick={() => setVisibleMonth(month => subMonths(month, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setVisibleMonth(startOfMonth(new Date()))}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Next"
              onClick={() => setVisibleMonth(month => addMonths(month, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className={cn("ml-2 font-semibold truncate", isCompact ? "text-xs" : "text-sm")}>
              {format(visibleMonth, "MMMM yyyy")}
            </span>
          </div>
          <div className="flex items-center rounded-md border p-0.5">
            {(["month", "agenda"] as CalendarView[]).map(option => (
              <Button
                key={option}
                type="button"
                variant={view === option ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                aria-pressed={view === option}
                onClick={() => setViewOverride(option)}
              >
                {option === "month" ? "Month" : "Agenda"}
              </Button>
            ))}
          </div>
        </div>

        {view === "month" ? (
          <MonthGrid
            visibleMonth={visibleMonth}
            weekStartsOn={config.weekStartsOn}
            eventsByDay={eventsByDay}
            options={options}
          />
        ) : (
          <AgendaList visibleMonth={visibleMonth} eventsByDay={eventsByDay} options={options} />
        )}

        <UnscheduledSection nodes={unscheduled} options={options} />

        {issues.length > 0 && (
          <p className={cn("text-muted-foreground", textSize)}>
            {issues.length} {issues.length === 1 ? "node is" : "nodes are"} not shown because its template has no
            &quot;{config.dateFieldName}&quot; date field.
          </p>
        )}
      </div>
      <DragOverlay>
        {activeNode && (
          <div className="pointer-events-none w-48">
            <EventBody
              node={activeNode}
              template={activeTemplate}
              isCompact={isCompact}
              fields={[]}
              className={textSize}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface MonthGridProps {
  visibleMonth: Date;
  weekStartsOn: 0 | 1;
  eventsByDay: Map<string, TreeNode[]>;
  options: EventViewOptions;
}

function MonthGrid({ visibleMonth, weekStartsOn, eventsByDay, options }: MonthGridProps) {
  const weeks = useMemo(() => buildMonthGrid(visibleMonth, weekStartsOn), [visibleMonth, weekStartsOn]);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-7">
        {weeks[0].map(day => (
          <div key={dayKey(day)} className="min-w-0 truncate px-1 pb-1 text-center text-[11px] font-medium text-muted-foreground">
            {format(day, "EEE")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border">
        {weeks.flat().map(day => (
          <MonthDayCell
            key={dayKey(day)}
            day={day}
            inMonth={isSameMonth(day, visibleMonth)}
            events={eventsByDay.get(dayKey(day)) ?? []}
            options={options}
          />
        ))}
      </div>
    </div>
  );
}

interface MonthDayCellProps {
  day: Date;
  inMonth: boolean;
  events: TreeNode[];
  options: EventViewOptions;
}

function MonthDayCell({ day, inMonth, events, options }: MonthDayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${DAY_TARGET_PREFIX}${dayKey(day)}`,
    disabled: !options.interactive,
  });
  const today = isToday(day);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[5rem] min-w-0 flex-col gap-0.5 bg-card p-1",
        !inMonth && "bg-muted/40",
        isOver && "bg-accent",
      )}
    >
      <div className="flex justify-end">
        <span
          className={cn(
            "px-1 text-[11px] leading-4",
            !inMonth && "text-muted-foreground",
            today && "rounded-sm bg-primary font-semibold text-primary-foreground",
          )}
        >
          {format(day, "d")}
        </span>
      </div>
      <div className={cn("flex min-w-0 flex-col gap-0.5", !inMonth && "opacity-60")}>
        {events.slice(0, MAX_EVENTS_PER_DAY).map(node => (
          <DraggableEvent key={node.id} node={node} options={options} showFields={false} className="text-[11px]" />
        ))}
        {events.length > MAX_EVENTS_PER_DAY && (
          <MoreEventsPopover events={events.slice(MAX_EVENTS_PER_DAY)} options={options} />
        )}
      </div>
    </div>
  );
}

function MoreEventsPopover({ events, options }: { events: TreeNode[]; options: EventViewOptions }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-5 justify-start px-1 text-[11px] font-normal">
          +{events.length} more
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-1 p-2">
        {events.map(node => (
          <div key={node.id} className="flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent">
            <NodeTitle
              node={node}
              template={options.templateById.get(node.templateId)}
              isCompact={options.isCompact}
              onClick={() => options.onOpenNode?.(node.id)}
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

interface AgendaListProps {
  visibleMonth: Date;
  eventsByDay: Map<string, TreeNode[]>;
  options: EventViewOptions;
}

function AgendaList({ visibleMonth, eventsByDay, options }: AgendaListProps) {
  const days = useMemo(() => getAgendaDays(eventsByDay, visibleMonth), [eventsByDay, visibleMonth]);

  if (days.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No scheduled events this month.</p>;
  }

  return (
    <div className="space-y-2">
      {days.map(({ key, day, events }) => (
        <AgendaDay key={key} day={day} events={events} options={options} />
      ))}
    </div>
  );
}

function AgendaDay({ day, events, options }: { day: Date; events: TreeNode[]; options: EventViewOptions }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${DAY_TARGET_PREFIX}${dayKey(day)}`,
    disabled: !options.interactive,
  });

  return (
    <section
      ref={setNodeRef}
      className={cn("space-y-1.5 rounded-md border p-2 transition-colors", isOver && "border-primary bg-accent")}
    >
      <h3 className={cn("text-xs font-semibold", isToday(day) && "text-primary")}>
        {format(day, "EEEE, PPP")}
      </h3>
      {events.map(node => (
        <DraggableEvent key={node.id} node={node} options={options} showFields />
      ))}
    </section>
  );
}

function UnscheduledSection({ nodes, options }: { nodes: TreeNode[]; options: EventViewOptions }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED_TARGET, disabled: !options.interactive });

  return (
    <section
      ref={setNodeRef}
      className={cn("space-y-1.5 rounded-md border border-dashed p-2 transition-colors", isOver && "border-primary bg-accent")}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Unscheduled</h3>
        <Badge variant="secondary">{nodes.length}</Badge>
      </div>
      {nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No unscheduled events</p>
      ) : (
        nodes.map(node => <DraggableEvent key={node.id} node={node} options={options} showFields />)
      )}
    </section>
  );
}

interface DraggableEventProps {
  node: TreeNode;
  options: EventViewOptions;
  showFields: boolean;
  className?: string;
}

function DraggableEvent({ node, options, showFields, className }: DraggableEventProps) {
  const template = options.templateById.get(node.templateId);
  const dateField = findCalendarDateField(template, options.config.dateFieldName);
  const currentDay = dateField ? parseDateFieldValue(node.data?.[dateField.id]) : null;
  const canDrag = options.interactive && !!dateField;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: node.id,
    disabled: !canDrag,
  });
  const open = useNodeOpenHandlers(node.id, { onOpen: options.onOpenNode, onEdit: options.onEditNode });
  const fields = showFields ? getNodeCardFields(node, getCalendarCardFields(template, options.config), options.dateFormat) : [];

  return (
    <div ref={setNodeRef} className={cn("min-w-0", isDragging && "opacity-40")}>
      <EventBody
        node={node}
        template={template}
        isCompact={options.isCompact}
        fields={fields}
        className={className}
        open={open}
        handle={canDrag ? (
          <Button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 cursor-grab touch-none"
            aria-label="Drag event"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        menu={options.interactive ? (
          <SetDateMenu
            currentDay={currentDay}
            onSetDay={(targetDayKey) => options.onSetDay(node.id, targetDayKey)}
          />
        ) : null}
      />
    </div>
  );
}

interface EventBodyProps {
  node: TreeNode;
  template: Template | undefined;
  isCompact: boolean;
  fields: NodeCardField[];
  className?: string;
  open?: { onTitleClick: () => void; onDoubleClick: () => void };
  handle?: React.ReactNode;
  menu?: React.ReactNode;
}

function EventBody({ node, template, isCompact, fields, className, open, handle, menu }: EventBodyProps) {
  return (
    <div
      onDoubleClick={open?.onDoubleClick}
      className="min-w-0 space-y-1 rounded-sm border bg-card px-1.5 py-1 text-card-foreground shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-1">
        {handle}
        <NodeTitle
          node={node}
          template={template}
          isCompact={isCompact}
          onClick={open?.onTitleClick}
          className={className}
        />
        {menu}
      </div>
      <NodeCardFieldLines fields={fields} isCompact={isCompact} />
    </div>
  );
}

function SetDateMenu({
  currentDay,
  onSetDay,
}: {
  currentDay: Date | null;
  onSetDay: (targetDayKey: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <span className="shrink-0">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0" aria-label="Event actions">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </PopoverAnchor>
        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => setPickerOpen(true)}>Set date...</DropdownMenuItem>
          {currentDay && <DropdownMenuItem onSelect={() => onSetDay(null)}>Clear date</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="start" className="w-auto p-0">
        <DayPicker
          mode="single"
          selected={currentDay ?? undefined}
          defaultMonth={currentDay ?? undefined}
          onSelect={(day) => {
            if (day) onSetDay(dayKey(day));
            setPickerOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
