"use client";

import React, { useId } from 'react';
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { ListChecks, GripVertical, Trash2, PlusCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn, generateClientSideId } from '@/lib/utils';
import { Field, ChecklistItem } from '@/lib/types';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTreeContext } from "@/contexts/tree-context";

const DraggableCheckboxItem = ({ id, children }: { id: string; children: React.ReactNode; }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 w-full">
      <Button {...attributes} {...listeners} type="button" variant="ghost" size="icon" className="h-8 w-8 cursor-grab shrink-0">
        <GripVertical className="h-4 w-4" />
      </Button>
      {children}
    </div>
  );
};

const ChecklistEditorComponent = React.memo(({ field, value, onChange }: { field: Field; value: any; onChange: (val: any) => void }) => {
  const items: ChecklistItem[] = value || [];
  const sensors = useSensors(useSensor(PointerSensor));
  const dndContextId = useId();

  return (
    <div key={field.id} className="space-y-2">
      <DndContext id={`${dndContextId}-checklist`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => {
          const { active, over } = event;
          if (over && active.id !== over.id) {
            const oldIndex = items.findIndex(item => item.id === active.id);
            const newIndex = items.findIndex(item => item.id === over.id);
            if (oldIndex !== -1 && newIndex !== -1) {
              onChange(arrayMove(items, oldIndex, newIndex));
            }
          }
        }}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((item, index) => (
              <DraggableCheckboxItem key={item.id} id={item.id}>
                <div className="flex items-center gap-2 w-full">
                  <Checkbox checked={item.checked} onCheckedChange={(checked) => {
                    const newItems = [...items]; newItems[index] = { ...item, checked: !!checked }; onChange(newItems);
                  }} />
                  <Input value={item.text} onChange={(e) => {
                    const newItems = [...items]; newItems[index] = { ...item, text: e.target.value }; onChange(newItems);
                  }} className="h-8" />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onChange(items.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </DraggableCheckboxItem>
            ))}
          </SortableContext>
        </DndContext>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { id: generateClientSideId(), text: '', checked: false }])} className="mt-2">
          <PlusCircle className="mr-2 h-4 w-4" /> Add Item
        </Button>
    </div>
  );
});
ChecklistEditorComponent.displayName = "ChecklistEditorComponent";

const ChecklistViewerComponent = ({ field, value, node, readOnly, isCompactView }: any) => {
  const items: ChecklistItem[] = value || [];
  const { updateNode } = useTreeContext();

  if (items.length === 0) return null;

  const handleCheckboxChange = (fieldId: string, itemId: string, checked: boolean) => {
    if (readOnly || !node || !updateNode) return;
    const currentItems: ChecklistItem[] = node.data[fieldId] || [];
    const newItems = currentItems.map(item =>
      item.id === itemId ? { ...item, checked } : item
    );
    const newData = {
      ...node.data,
      [fieldId]: newItems,
    };
    updateNode(node.id, { data: newData });
  };

  return (
    <div key={field.id} className="mt-4" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <p className={cn("font-medium mb-2", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-2">
            <Checkbox
              checked={item.checked}
              disabled={readOnly}
              onCheckedChange={(checked) => handleCheckboxChange(field.id, item.id, !!checked)}
            />
            <span className={cn(item.checked && "text-muted-foreground", isCompactView ? "text-xs" : "text-sm")}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ChecklistPlugin: FieldTypePlugin = {
  type: "checklist",
  label: "Checklist",
  icon: ListChecks,
  EditorComponent: ChecklistEditorComponent,
  ViewerComponent: ChecklistViewerComponent,
};
