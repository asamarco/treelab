
/**
 * @fileoverview
 * This component renders the collapsible content area of a tree node.
 * It displays complex fields like image carousels, attachment lists, and tables,
 * as well as the formatted body text and recursively rendered child nodes.
 * Optimized for mobile to prevent horizontal overflow on indented content.
 */
"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { TreeNode, Template, AttachmentInfo, QueryDefinition, ChecklistItem, QueryRule, ConditionalRuleOperator, QueryFieldValue, normalizeQueryFieldValue } from "@/lib/types";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { RenderWithLinks } from "./render-with-links";
import { Icon } from "../icon";
import { Crosshair } from "lucide-react";
import { TreeNodeComponent } from "./tree-node";
import { formatDate } from "@/lib/utils";
import { useAuthContext } from "@/contexts/auth-context";
import { TreeNodeDropZone } from "./tree-node-dropzone";
import { WritableDraft } from "immer";
import { Button } from "../ui/button";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { getConditionalStyle } from "./tree-node-utils";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { TreeSpreadsheetField } from "./tree-spreadsheet-field";
import { FieldRegistry, isValueEmpty } from "@/lib/field-types";

const operatorLabels: Record<string, string> = {
    equals: 'Equals',
    not_equals: 'Not Equals',
    contains: 'Contains',
    not_contains: 'Does Not Contain',
    is_not_empty: 'Is Not Empty',
    is_empty: 'Is Empty',
    greater_than: 'Greater Than',
    less_than: 'Less Than',
};

/** Field types eligible as query result table columns. */
const QUERY_COLUMN_FIELD_TYPES: import("@/lib/types").Field['type'][] = [
    'text', 'number', 'date', 'dropdown', 'textarea', 'link', 'dynamic-dropdown', 'checkbox',
    'table-header',
];

const QUERY_PAGE_SIZE = 25;


interface TreeNodeContentProps {
    node: TreeNode;
    template: Template;
    isExpanded: boolean;
    level: number;
    onSelect: (instanceId: string, isShiftClick: boolean, isCtrlClick: boolean) => void;
    contextualParentId: string | null;
    overrideExpandedIds?: string[];
    onExpandedChange?: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
    isCompactOverride?: boolean;
    isExplorer?: boolean;
    readOnly?: boolean;
    disableSelection?: boolean;
    onNodeClick?: (nodeId: string) => void;
    /**
     * Ancestry chain for this rendering instance (root → immediate parent of
     * `node`). Forwarded to RenderWithLinks and extended before being passed to
     * child TreeNodeComponents.
     */
    ancestorChain?: TreeNode[];
}


function TreeNodeContentInner({ node, template, isExpanded, level, onSelect, contextualParentId, overrideExpandedIds, onExpandedChange, isCompactOverride, isExplorer, readOnly = false, disableSelection = false, onNodeClick, ancestorChain = [] }: TreeNodeContentProps) {
    const { currentUser } = useAuthContext();
    const { findNodesByQuery, getTemplateById, setSelectedNodeIds, findNodeAndParent, expandToNode, updateNode, selectAndCenterNode } = useTreeContext();
    const { setDialogState, isCompactView: globalIsCompactView } = useUIContext();
    const isMobile = useIsMobile();
    const { toast } = useToast();

    const isCompactView = isCompactOverride ?? globalIsCompactView;

    const nodeData = node.data || {};

    // Pagination: fieldId -> templateId -> page index (0-based)
    const [queryPageStates, setQueryPageStates] = useState<Record<string, Record<string, number>>>({});

    const getQueryPage = (fieldId: string, templateId: string) =>
        queryPageStates[fieldId]?.[templateId] ?? 0;

    const setQueryPage = (fieldId: string, templateId: string, page: number) => {
        setQueryPageStates(prev => ({
            ...prev,
            [fieldId]: { ...(prev[fieldId] ?? {}), [templateId]: page },
        }));
    };

    // Groups of *contiguous* table-header fields that have at least one non-empty value.
    // Each group renders as its own table.
    const tableGroups = useMemo(() => {
        const groups: { fields: (typeof template.fields[number])[]; rowCount: number }[] = [];
        let current: (typeof template.fields[number])[] = [];
        for (const f of template.fields) {
            if (f.type === 'table-header') {
                current.push(f);
            } else {
                if (current.length > 0) { groups.push({ fields: current, rowCount: 0 }); current = []; }
            }
        }
        if (current.length > 0) groups.push({ fields: current, rowCount: 0 });

        // Resolve row count and filter to groups with actual data.
        return groups
            .map(grp => {
                const visibleFields = grp.fields.filter(f => {
                    const col = nodeData[f.id];
                    return Array.isArray(col) && col.some(val => !isValueEmpty(val));
                });
                if (visibleFields.length === 0) return null;
                const firstColumnData = nodeData[visibleFields[0].id];
                const rowCount = Array.isArray(firstColumnData) ? firstColumnData.length : 0;
                return { fields: visibleFields, rowCount };
            })
            .filter((g): g is { fields: (typeof template.fields[number])[]; rowCount: number } => g !== null && g.rowCount > 0);
    }, [template.fields, nodeData]);

    // fieldId -> group index for O(1) lookup in renderSingleField
    const fieldToGroupIndex = useMemo(() => {
        const map = new Map<string, number>();
        tableGroups.forEach((grp, gi) => grp.fields.forEach(f => map.set(f.id, gi)));
        return map;
    }, [tableGroups]);

    const queryFields = useMemo(() => template.fields.filter(f => f.type === 'query'), [template.fields]);

    const queriesAndResults = useMemo(() => {
        if (isCompactOverride) return [];
        return queryFields.map(field => {
            const rawValue = nodeData[field.id];
            const { queries: queryDefinitions, displayColumns } = normalizeQueryFieldValue(rawValue);

            if (queryDefinitions.length === 0) {
                return { field, displayColumns, resultsByTemplate: new Map<string, TreeNode[]>(), queryDefinitions };
            }

            const combinedResults = new Map<string, TreeNode>();

            queryDefinitions.forEach((queryDef: QueryDefinition) => {
                if (queryDef && queryDef.targetTemplateId) {
                    const results = findNodesByQuery(queryDef);
                    results.forEach(node => combinedResults.set(node.id, node));
                }
            });

            // Group results by templateId; sort each group by name.
            const resultsByTemplate = new Map<string, TreeNode[]>();
            combinedResults.forEach(resultNode => {
                const tid = resultNode.templateId;
                if (!resultsByTemplate.has(tid)) resultsByTemplate.set(tid, []);
                resultsByTemplate.get(tid)!.push(resultNode);
            });
            resultsByTemplate.forEach((nodes) => {
                nodes.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
            });

            return { field, displayColumns, resultsByTemplate, queryDefinitions };
        });
    }, [queryFields, nodeData, findNodesByQuery, isCompactOverride]);

    if (!isExpanded) {
        return null;
    }

    const isHandleHidden = isMobile || readOnly || disableSelection || isExplorer || isCompactView;
    const showVerticalLines = isCompactView || isExplorer;
    const verticalLineClass = showVerticalLines ? "border-l border-border/50" : "";

    const leftMargin = showVerticalLines
        ? (isHandleHidden ? "ml-[13.5px]" : "ml-[43.5px]")
        : "ml-0";

    return (
        <CollapsibleContent className="min-w-0 w-full overflow-hidden">
            <div className={cn("min-w-0 pt-2", isCompactView && "pt-0", isExplorer && "pt-0")} onClick={(e) => e.stopPropagation()}>
                <div className={cn("min-w-0 transition-all pb-1", verticalLineClass, leftMargin, isExplorer && "pb-0 pr-0", !isExplorer && "pr-0")}>
                    {!isCompactOverride && (
                        <div className={cn("pl-3 pb-1 pr-1 min-w-0 flex flex-col")}>
                            {template.bodyTemplate && (
                                <div className={cn("text-foreground/90 whitespace-pre-wrap pt-2", isCompactView ? "text-xs" : "text-sm")} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                <RenderWithLinks node={node} template={template} text={template.bodyTemplate} ancestorChain={ancestorChain} />
                                </div>
                            )}

                            {(() => {
                                const renderSingleField = (field: (typeof template.fields)[number]) => {
                                    const value = nodeData[field.id];

                                    const plugin = FieldRegistry.get(field.type);
                                    if (plugin?.ViewerComponent) {
                                        const Viewer = plugin.ViewerComponent;
                                        return <Viewer key={field.id} field={field} value={value} node={node} readOnly={readOnly} isCompactView={isCompactView} ancestorChain={ancestorChain} />;
                                    }

                                    switch (field.type) {
                                        case 'checkbox': {
                                            const isChecked = !!value;
                                            return (
                                                <div key={field.id} className="mt-2 flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox
                                                        id={`view-${node.id}-${field.id}`}
                                                        checked={isChecked}
                                                        disabled={readOnly}
                                                        onCheckedChange={(checked) => {
                                                            if (updateNode && !readOnly) {
                                                                updateNode(node.id, { data: { ...node.data, [field.id]: !!checked } });
                                                            }
                                                        }}
                                                    />
                                                    <Label htmlFor={`view-${node.id}-${field.id}`} className={cn("font-normal", isChecked && "text-muted-foreground", isCompactView && "text-xs")}>
                                                        {field.name}
                                                    </Label>
                                                </div>
                                            );
                                        }

                                        case 'table-header': {
                                            // Only the first field of each contiguous group renders the table;
                                            // subsequent fields in the same group return null.
                                            const groupIndex = fieldToGroupIndex.get(field.id);
                                            if (groupIndex === undefined) return null;
                                            const group = tableGroups[groupIndex];
                                            if (group.fields[0].id !== field.id) return null;

                                            return (
                                                <div key={`table-block-${groupIndex}`} className="mt-2 text-sm min-w-0" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                    <div className="overflow-x-auto rounded-md border min-w-0">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow className={cn(isCompactView && "h-8")}>
                                                                    {group.fields.map(f => <TableHead key={f.id} className={cn(isCompactView && "h-8 px-2 text-xs")}>{f.name}</TableHead>)}
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {Array.from({ length: group.rowCount }).map((_, rowIndex) => (
                                                                    <TableRow key={rowIndex} className={cn(isCompactView && "h-8")}>
                                                                        {group.fields.map(f => {
                                                                            let cellValue = nodeData[f.id]?.[rowIndex] || '';
                                                                            let displayValue = cellValue;

                                                                            if (f.columnType === 'date' && cellValue) {
                                                                                displayValue = formatDate(cellValue, currentUser?.dateFormat);
                                                                            }

                                                                            if (displayValue) {
                                                                                displayValue = `${f.prefix || ''}${displayValue}${f.postfix || ''}`;
                                                                            }

                                                                            return (
                                                                                <TableCell key={f.id} className={cn(isCompactView && "py-1 px-2 text-xs")}>{displayValue}</TableCell>
                                                                            )
                                                                        })}
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                </div>
                                            )
                                        }
                                        case 'query': {
                                            const queryResult = queriesAndResults.find(q => q.field.id === field.id);
                                            if (!queryResult) return null;
                                            const { resultsByTemplate, displayColumns, queryDefinitions } = queryResult;

                                            const finalQueryStr = queryDefinitions.map(queryDef => {
                                                const targetTemplate = getTemplateById(queryDef.targetTemplateId || '');
                                                const targetTemplateName = targetTemplate ? targetTemplate.name : 'any';

                                                const ruleStrings = (queryDef.rules || []).map(rule => {
                                                    if (rule.type === 'field') {
                                                        const ruleField = targetTemplate?.fields.find(f => f.id === rule.fieldId);
                                                        const fieldName = ruleField ? ruleField.name : rule.fieldId || 'Field';
                                                        const op = operatorLabels[rule.operator || ''] || rule.operator || 'equals';
                                                        const hasNoVal = rule.operator === 'is_empty' || rule.operator === 'is_not_empty';
                                                        return `'${fieldName}' ${op.toLowerCase()}${hasNoVal ? '' : ` '${rule.value || ''}'`}`;
                                                    } else {
                                                        const relTemplate = rule.relationTemplateId ? getTemplateById(rule.relationTemplateId) : null;
                                                        const relTemplateName = relTemplate ? relTemplate.name : 'any';
                                                        const relRulesStr = (rule.relationRules || []).map(relRule => {
                                                            const relField = relTemplate?.fields.find(f => f.id === relRule.fieldId);
                                                            const relFieldName = relField ? relField.name : relRule.fieldId || 'Field';
                                                            const relOp = operatorLabels[relRule.operator || ''] || relRule.operator || 'equals';
                                                            const relHasNoVal = relRule.operator === 'is_empty' || relRule.operator === 'is_not_empty';
                                                            return `'${relFieldName}' ${relOp.toLowerCase()}${relHasNoVal ? '' : ` '${relRule.value || ''}'`}`;
                                                        }).join(' AND ');

                                                        const relCond = relRulesStr ? ` where ${relRulesStr}` : '';
                                                        return `has ${rule.type} '${relTemplateName}'${relCond}`;
                                                    }
                                                });

                                                const joinedRules = ruleStrings.join(' AND ');
                                                const rulesPart = ruleStrings.length > 0 ? ` where ${joinedRules}` : '';
                                                const groupStr = `'${targetTemplateName}' nodes${rulesPart}`;
                                                return queryDefinitions.length > 1 ? `(${groupStr})` : groupStr;
                                            }).join(' OR ');

                                            const displayQuery = finalQueryStr || 'No query defined';
                                            const totalResults = Array.from(resultsByTemplate.values()).reduce((sum, nodes) => sum + nodes.length, 0);

                                            /** Format a cell value for a given field of a result node. */
                                            const formatCellValue = (resultNode: TreeNode, colField: (typeof template.fields)[number]): string => {
                                                const cellRaw = resultNode.data?.[colField.id];
                                                if (colField.type === 'checkbox') {
                                                    return cellRaw ? '✓' : '';
                                                }
                                                if (colField.type === 'date') {
                                                    return cellRaw ? formatDate(cellRaw, currentUser?.dateFormat) : '';
                                                }
                                                if (colField.type === 'table-header') {
                                                    // table-header stores an array; format each entry with prefix/postfix and date formatting
                                                    if (!Array.isArray(cellRaw)) return '';
                                                    return cellRaw.map((entry: string) => {
                                                        let v = entry || '';
                                                        if (colField.columnType === 'date' && v) {
                                                            v = formatDate(v, currentUser?.dateFormat);
                                                        }
                                                        if (v) v = `${colField.prefix || ''}${v}${colField.postfix || ''}`;
                                                        return v;
                                                    }).filter(Boolean).join(', ');
                                                }
                                                // text, number, textarea, link, dropdown, dynamic-dropdown: raw string
                                                return cellRaw != null ? String(cellRaw) : '';
                                            };

                                            /** Reusable click-to-jump row item (matches existing list behavior). */
                                            const renderListItem = (resultNode: TreeNode) => {
                                                const resultTemplate = getTemplateById(resultNode.templateId);
                                                const { icon: resultIcon, color: resultColor } = getConditionalStyle(resultNode, resultTemplate);
                                                return (
                                                    <div key={resultNode.id} className="flex items-center justify-between gap-2 p-1.5 -ml-1.5 rounded-md hover:bg-accent group/queryresult">
                                                        <div className="flex items-center gap-2 overflow-hidden flex-grow">
                                                            <div
                                                                className="flex items-center gap-2 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [resultNode.id] });
                                                                }}
                                                            >
                                                                <Icon name={resultIcon as any} className="h-4 w-4 shrink-0" style={{ color: resultColor }} />
                                                                <span className={cn("font-medium truncate", isCompactView ? "text-xs" : "text-sm")}>{resultNode.name}</span>
                                                            </div>
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-6 w-6 shrink-0 opacity-0 group-hover/queryresult:opacity-100"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                selectAndCenterNode({ nodeId: resultNode.id });
                                                                            }}
                                                                        >
                                                                            <Crosshair className="h-4 w-4" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>Locate node in tree</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        </div>
                                                    </div>
                                                );
                                            };

                                            return (
                                                <div key={field.id} className="mt-4 pt-2 border-t border-border/40 min-w-0">
                                                    <div className="flex flex-col gap-1 mb-2">
                                                        <p className={cn("text-xs text-muted-foreground/80 bg-muted/40 p-2 rounded border border-border/50 break-words", isCompactView ? "text-[11px]" : "text-xs")}>
                                                            {displayQuery}
                                                        </p>
                                                    </div>

                                                    {totalResults === 0 ? (
                                                        <p className="text-sm text-muted-foreground italic px-2 py-1">Query returned no results.</p>
                                                    ) : (
                                                        <div className="space-y-4 mt-1">
                                                            {Array.from(resultsByTemplate.entries()).map(([templateId, templateNodes]) => {
                                                                const targetTemplate = getTemplateById(templateId);

                                                                // Resolve display columns: filter to valid QUERY_COLUMN_FIELD_TYPES and existing fields
                                                                const rawCols = displayColumns[templateId] ?? [];
                                                                const colFields = rawCols
                                                                    .map(colId => targetTemplate?.fields.find(f => f.id === colId))
                                                                    .filter((f): f is NonNullable<typeof f> =>
                                                                        f != null && QUERY_COLUMN_FIELD_TYPES.includes(f.type)
                                                                    );

                                                                const page = getQueryPage(field.id, templateId);
                                                                const pageStart = page * QUERY_PAGE_SIZE;
                                                                const pageEnd = pageStart + QUERY_PAGE_SIZE;
                                                                const pageNodes = templateNodes.slice(pageStart, pageEnd);
                                                                const totalPages = Math.ceil(templateNodes.length / QUERY_PAGE_SIZE);

                                                                const templateLabel = targetTemplate?.name ?? templateId;

                                                                return (
                                                                    <div key={templateId} className="space-y-1">
                                                                        {resultsByTemplate.size > 1 && (
                                                                            <p className={cn("text-xs font-semibold text-muted-foreground uppercase tracking-wide", isCompactView && "text-[10px]")}>
                                                                                {templateLabel} ({templateNodes.length})
                                                                            </p>
                                                                        )}

                                                                        {colFields.length === 0 ? (
                                                                            // Fallback: plain list (no columns selected yet)
                                                                            <div className="space-y-1 pl-1">
                                                                                {pageNodes.map(renderListItem)}
                                                                            </div>
                                                                        ) : (
                                                                            // Table view
                                                                            <div className="overflow-x-auto rounded-md border min-w-0" onClick={(e) => e.stopPropagation()}>
                                                                                <Table>
                                                                                    <TableHeader>
                                                                                        <TableRow className={cn(isCompactView && "h-8")}>
                                                                                            <TableHead className={cn("w-[180px]", isCompactView && "h-8 px-2 text-xs")}>Name</TableHead>
                                                                                            {colFields.map(f => (
                                                                                                <TableHead key={f.id} className={cn(isCompactView && "h-8 px-2 text-xs")}>{f.name}</TableHead>
                                                                                            ))}
                                                                                        </TableRow>
                                                                                    </TableHeader>
                                                                                    <TableBody>
                                                                                        {pageNodes.map(resultNode => {
                                                                                            const rTpl = getTemplateById(resultNode.templateId);
                                                                                            const { icon: rIcon, color: rColor } = getConditionalStyle(resultNode, rTpl);
                                                                                            return (
                                                                                                <TableRow
                                                                                                    key={resultNode.id}
                                                                                                    className={cn("cursor-pointer group/qrow", isCompactView && "h-8")}
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [resultNode.id] });
                                                                                                    }}
                                                                                                >
                                                                                                    <TableCell className={cn("font-medium", isCompactView && "py-1 px-2 text-xs")}>
                                                                                                        <div className="flex items-center gap-1.5">
                                                                                                            <Icon name={rIcon as any} className="h-3.5 w-3.5 shrink-0" style={{ color: rColor }} />
                                                                                                            <span className="truncate">{resultNode.name}</span>
                                                                                                            <TooltipProvider>
                                                                                                                <Tooltip>
                                                                                                                    <TooltipTrigger asChild>
                                                                                                                        <Button
                                                                                                                            variant="ghost"
                                                                                                                            size="icon"
                                                                                                                            className="h-6 w-6 shrink-0 opacity-0 group-hover/qrow:opacity-100"
                                                                                                                            onClick={(e) => {
                                                                                                                                e.stopPropagation();
                                                                                                                                selectAndCenterNode({ nodeId: resultNode.id });
                                                                                                                            }}
                                                                                                                        >
                                                                                                                            <Crosshair className="h-3.5 w-3.5" />
                                                                                                                        </Button>
                                                                                                                    </TooltipTrigger>
                                                                                                                    <TooltipContent><p>Locate node in tree</p></TooltipContent>
                                                                                                                </Tooltip>
                                                                                                            </TooltipProvider>
                                                                                                        </div>
                                                                                                    </TableCell>
                                                                                                    {colFields.map(colField => (
                                                                                                        <TableCell key={colField.id} className={cn(isCompactView && "py-1 px-2 text-xs")}>
                                                                                                            {formatCellValue(resultNode, colField)}
                                                                                                        </TableCell>
                                                                                                    ))}
                                                                                                </TableRow>
                                                                                            );
                                                                                        })}
                                                                                    </TableBody>
                                                                                </Table>
                                                                            </div>
                                                                        )}

                                                                        {/* Pagination */}
                                                                        {totalPages > 1 && (
                                                                            <div className="flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                                                                                <span className={cn("text-xs text-muted-foreground", isCompactView && "text-[10px]")}>
                                                                                    {pageStart + 1}–{Math.min(pageEnd, templateNodes.length)} of {templateNodes.length}
                                                                                </span>
                                                                                <div className="flex gap-1">
                                                                                    <Button
                                                                                        type="button"
                                                                                        variant="outline"
                                                                                        size="sm"
                                                                                        className="h-6 px-2 text-xs"
                                                                                        disabled={page === 0}
                                                                                        onClick={(e) => { e.stopPropagation(); setQueryPage(field.id, templateId, page - 1); }}
                                                                                    >
                                                                                        ‹
                                                                                    </Button>
                                                                                    <Button
                                                                                        type="button"
                                                                                        variant="outline"
                                                                                        size="sm"
                                                                                        className="h-6 px-2 text-xs"
                                                                                        disabled={page >= totalPages - 1}
                                                                                        onClick={(e) => { e.stopPropagation(); setQueryPage(field.id, templateId, page + 1); }}
                                                                                    >
                                                                                        ›
                                                                                    </Button>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }

                                        default:
                                            return null;
                                    }
                                };

                                if (isMobile) {
                                    return template.fields.map(renderSingleField);
                                }

                                const groups: { isRow: boolean; fields: typeof template.fields }[] = [];
                                template.fields.forEach(field => {
                                    const isEligible = !!field.sameRow && !!FieldRegistry.get(field.type);
                                    const lastGroup = groups[groups.length - 1];

                                    if (isEligible) {
                                        if (lastGroup && lastGroup.isRow) {
                                            lastGroup.fields.push(field);
                                        } else {
                                            groups.push({ isRow: true, fields: [field] });
                                        }
                                    } else {
                                        groups.push({ isRow: false, fields: [field] });
                                    }
                                });

                                return groups.map((group, idx) => {
                                    if (group.isRow) {
                                        const nonEmptyFields = group.fields.filter(field => {
                                            const plugin = FieldRegistry.get(field.type);
                                            const value = nodeData[field.id];
                                            const empty = plugin?.isEmpty ? plugin.isEmpty(value, field) : isValueEmpty(value, field);
                                            return !empty;
                                        });

                                        if (nonEmptyFields.length === 0) {
                                            return null;
                                        }

                                        if (nonEmptyFields.length === 1) {
                                            return renderSingleField(nonEmptyFields[0]);
                                        }

                                        return (
                                            <div key={`row-group-${idx}`} className="flex flex-row gap-4 w-full min-w-0">
                                                {nonEmptyFields.map(f => (
                                                    <div key={f.id} className="flex-1 min-w-0">
                                                        {renderSingleField(f)}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    }
                                    return group.fields.map(renderSingleField);
                                });
                            })()}
                        </div>
                    )}


                    {node.children && node.children.length > 0 && !isExplorer && (
                        <div
                            className={cn(
                                "children-container transition-all pr-0 pb-1",
                                "pl-3 space-y-0 pb-1 pr-0"
                            )}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {!readOnly && !disableSelection && <TreeNodeDropZone id={`gap_start_${node.id}`} />}
                            {node.children.map((childNode) => (
                                <div key={`${childNode.id}_${node.id}`}>
                                    <TreeNodeComponent
                                        node={childNode}
                                        level={level + 1}
                                        siblings={node.children}
                                        onSelect={onSelect as any}
                                        contextualParentId={node.id}
                                        overrideExpandedIds={overrideExpandedIds}
                                        onExpandedChange={onExpandedChange}
                                        isCompactOverride={isCompactOverride}
                                        isExplorer={isExplorer}
                                        readOnly={readOnly}
                                        disableSelection={disableSelection}
                                        onNodeClick={onNodeClick}
                                        ancestorChain={[...ancestorChain, node]}
                                    />
                                    {!readOnly && !disableSelection && <TreeNodeDropZone id={`gap_${childNode.id}_${node.id}`} />}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </CollapsibleContent>
    );
}

// Memoize to prevent re-rendering this heavy component (charts, images,
// tables, children) when only sibling nodes or unrelated state changes.
export const TreeNodeContent = React.memo(TreeNodeContentInner);
