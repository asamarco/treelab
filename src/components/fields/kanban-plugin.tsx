"use client";

import React, { useMemo } from "react";
import { KanbanSquare } from "lucide-react";
import { FieldTypePlugin } from "@/lib/field-types/registry";
import { Field, KanbanFieldValue, Template, normalizeKanbanFieldValue } from "@/lib/types";
import { generateNodeName } from "@/lib/utils";
import { useTreeContext } from "@/contexts/tree-context";
import { useAuthContext } from "@/contexts/auth-context";
import { useUIContext } from "@/contexts/ui-context";
import { useQueryNodes } from "@/components/tree/query-field/use-query-results";
import { QueryRulesEditor } from "@/components/tree/query-field/query-builder";
import { QUERY_COLUMN_FIELD_TYPES } from "@/components/tree/query-field/constants";
import { getColumnMergeKey } from "@/components/tree/query-field/merge-templates";
import { KanbanBoard } from "@/components/visualizations/kanban-board";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type KanbanViewerProps = React.ComponentProps<NonNullable<FieldTypePlugin["ViewerComponent"]>>;

const isKanbanUnconfigured = (value: unknown): boolean => {
  const config = normalizeKanbanFieldValue(value);
  return config.queries.length === 0 || !config.groupByFieldName;
};

const uniqueFieldOptions = (fields: Field[]) => {
  const seen = new Map<string, { value: string; label: string }>();
  for (const f of fields) {
    const key = getColumnMergeKey(f.name, f.type);
    if (!seen.has(key)) seen.set(key, { value: f.name, label: f.name });
  }
  return Array.from(seen.values());
};

const KanbanEditorComponent = ({ value, onChange }: { field: Field; value: unknown; onChange: (value: KanbanFieldValue) => void }) => {
  const { getTemplateById } = useTreeContext();
  const config = normalizeKanbanFieldValue(value);

  const targetTemplates = config.queries.flatMap((q): Template[] => {
    const template = q.targetTemplateId ? getTemplateById(q.targetTemplateId) : undefined;
    return template ? [template] : [];
  });
  const groupByOptions = uniqueFieldOptions(
    targetTemplates.flatMap(t => t.fields.filter(f => f.type === "dropdown")),
  );
  const cardFieldOptions = uniqueFieldOptions(
    targetTemplates.flatMap(t => t.fields.filter(f => QUERY_COLUMN_FIELD_TYPES.includes(f.type))),
  );

  const update = (patch: Partial<KanbanFieldValue>) => onChange({ ...config, ...patch, schemaVersion: 1 });

  return (
    <div className="space-y-4">
      <QueryRulesEditor queryDefs={config.queries} onChange={(queries) => update({ queries })} />
      <div className="space-y-2">
        <Label>Group by (dropdown field)</Label>
        <Select value={config.groupByFieldName || undefined} onValueChange={(groupByFieldName) => update({ groupByFieldName })}>
          <SelectTrigger>
            <SelectValue placeholder={groupByOptions.length ? "Select a dropdown field" : "No dropdown fields in these queries"} />
          </SelectTrigger>
          <SelectContent>
            {groupByOptions.map(option => (
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
          placeholder="Select fields to show on cards"
        />
      </div>
    </div>
  );
};

const KanbanViewerComponent = ({ value, node, readOnly, isCompactView }: KanbanViewerProps) => {
  const config = useMemo(() => normalizeKanbanFieldValue(value), [value]);
  const nodes = useQueryNodes(config.queries);
  const { templates, getTemplateById, updateNode, findNodeAndParent } = useTreeContext();
  const { setDialogState, dialogState } = useUIContext();
  const { currentUser } = useAuthContext();

  if (!node || isKanbanUnconfigured(value)) return null;

  const handleMoveNode = (nodeId: string, patch: Record<string, string>) => {
    const target = nodes.find(n => n.id === nodeId);
    const template = target ? getTemplateById(target.templateId) : undefined;
    if (!target || !template) return;
    const data = { ...(target.data || {}), ...patch };
    updateNode(target.id, { data, name: generateNodeName(template, data) });
  };

  const handleOpenNode = (nodeId: string) => {
    setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [nodeId] });
  };

  const handleEditNode = (nodeId: string) => {
    const parentInfo = findNodeAndParent ? findNodeAndParent(nodeId) : null;
    const instanceId = `${nodeId}_${parentInfo?.parent?.id || "root"}`;
    const currentIds = dialogState.openNodeEditInstanceIds || [];
    if (!currentIds.includes(instanceId)) {
      setDialogState({ openNodeEditInstanceIds: [...currentIds, instanceId] });
    }
  };

  return (
    <KanbanBoard
      nodes={nodes}
      templates={templates}
      config={config}
      readOnly={!!readOnly}
      isCompact={!!isCompactView}
      dateFormat={currentUser?.dateFormat}
      onMoveNode={handleMoveNode}
      onOpenNode={handleOpenNode}
      onEditNode={handleEditNode}
    />
  );
};

export const KanbanPlugin: FieldTypePlugin = {
  type: "kanban",
  label: "Kanban",
  icon: KanbanSquare,
  EditorComponent: KanbanEditorComponent,
  ViewerComponent: KanbanViewerComponent,
  isEmpty: (value: unknown) => isKanbanUnconfigured(value),
  sanitizeOnSave: (value: unknown) => normalizeKanbanFieldValue(value),
  excludeFromStaticExport: true,
};
