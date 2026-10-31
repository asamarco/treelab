"use client";

import React, { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { FieldTypePlugin } from "@/lib/field-types/registry";
import { CalendarFieldValue, Field, Template, normalizeCalendarFieldValue } from "@/lib/types";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { useQueryNodes } from "@/components/tree/query-field/use-query-results";
import { QueryRulesEditor } from "@/components/tree/query-field/query-builder";
import { QUERY_COLUMN_FIELD_TYPES } from "@/components/tree/query-field/constants";
import { CalendarBoard } from "@/components/visualizations/calendar-board";
import { useBoardNodeActions } from "@/components/visualizations/shared/use-board-node-actions";
import { uniqueFieldOptions } from "@/components/visualizations/shared/field-options";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CalendarViewerProps = React.ComponentProps<NonNullable<FieldTypePlugin["ViewerComponent"]>>;

const isCalendarUnconfigured = (value: unknown): boolean => {
  const config = normalizeCalendarFieldValue(value);
  return config.queries.length === 0 || !config.dateFieldName;
};

const CalendarEditorComponent = ({ value, onChange }: { field: Field; value: unknown; onChange: (value: CalendarFieldValue) => void }) => {
  const { getTemplateById } = useTreeContext();
  const config = normalizeCalendarFieldValue(value);

  const targetTemplates = config.queries.flatMap((q): Template[] => {
    const template = q.targetTemplateId ? getTemplateById(q.targetTemplateId) : undefined;
    return template ? [template] : [];
  });
  const dateFieldOptions = uniqueFieldOptions(
    targetTemplates.flatMap(t => t.fields.filter(f => f.type === "date")),
  );
  const cardFieldOptions = uniqueFieldOptions(
    targetTemplates.flatMap(t => t.fields.filter(f => QUERY_COLUMN_FIELD_TYPES.includes(f.type))),
  );

  const update = (patch: Partial<CalendarFieldValue>) => onChange({ ...config, ...patch, schemaVersion: 1 });

  return (
    <div className="space-y-4">
      <QueryRulesEditor queryDefs={config.queries} onChange={(queries) => update({ queries })} />
      <div className="space-y-2">
        <Label>Date field</Label>
        <Select value={config.dateFieldName || undefined} onValueChange={(dateFieldName) => update({ dateFieldName })}>
          <SelectTrigger>
            <SelectValue placeholder={dateFieldOptions.length ? "Select a date field" : "No date fields in these queries"} />
          </SelectTrigger>
          <SelectContent>
            {dateFieldOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Card fields</Label>
        <MultiSelect
          options={cardFieldOptions}
          selected={config.cardFieldNames}
          onChange={(cardFieldNames) => update({ cardFieldNames })}
          placeholder="Select fields to show in the agenda"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>First day of week</Label>
          <Select value={String(config.weekStartsOn)} onValueChange={(v) => update({ weekStartsOn: v === "0" ? 0 : 1 })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Monday</SelectItem>
              <SelectItem value="0">Sunday</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Default view</Label>
          <Select value={config.defaultView} onValueChange={(v) => update({ defaultView: v === "agenda" ? "agenda" : "month" })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="agenda">Agenda</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

const CalendarViewerComponent = ({ value, node, readOnly, isCompactView }: CalendarViewerProps) => {
  const config = useMemo(() => normalizeCalendarFieldValue(value), [value]);
  const nodes = useQueryNodes(config.queries);
  const { templates } = useTreeContext();
  const { currentUser } = useAuthContext();
  const { moveNode, openNode, editNode } = useBoardNodeActions(nodes);

  if (!node || isCalendarUnconfigured(value)) return null;

  return (
    <CalendarBoard
      nodes={nodes}
      templates={templates}
      config={config}
      readOnly={!!readOnly}
      isCompact={!!isCompactView}
      dateFormat={currentUser?.dateFormat}
      onMoveNode={moveNode}
      onOpenNode={openNode}
      onEditNode={editNode}
    />
  );
};

export const CalendarPlugin: FieldTypePlugin = {
  type: "calendar",
  label: "Calendar",
  icon: CalendarDays,
  EditorComponent: CalendarEditorComponent,
  ViewerComponent: CalendarViewerComponent,
  isEmpty: (value: unknown) => isCalendarUnconfigured(value),
  sanitizeOnSave: (value: unknown) => normalizeCalendarFieldValue(value),
  excludeFromStaticExport: true,
};
