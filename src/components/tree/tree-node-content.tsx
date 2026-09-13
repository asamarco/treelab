
/**
 * @fileoverview
 * This component renders the collapsible content area of a tree node.
 * It displays complex fields like image carousels, attachment lists, and tables,
 * as well as the formatted body text and recursively rendered child nodes.
 * Optimized for mobile to prevent horizontal overflow on indented content.
 */
"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { TreeNode, Template, AttachmentInfo, XYChartData, QueryDefinition, ChecklistItem, QueryRule, ConditionalRuleOperator } from "@/lib/types";
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
}


function TreeNodeContentInner({ node, template, isExpanded, level, onSelect, contextualParentId, overrideExpandedIds, onExpandedChange, isCompactOverride, isExplorer, readOnly = false, disableSelection = false, onNodeClick }: TreeNodeContentProps) {
    const { currentUser } = useAuthContext();
    const { findNodesByQuery, getTemplateById, setSelectedNodeIds, findNodeAndParent, expandToNode, updateNode, selectAndCenterNode } = useTreeContext();
    const { setDialogState, isCompactView: globalIsCompactView } = useUIContext();
    const isMobile = useIsMobile();
    const { toast } = useToast();

    const isCompactView = isCompactOverride ?? globalIsCompactView;

    const nodeData = node.data || {};
    let tableRendered = false;




    const tableHeaderFields = useMemo(() => {
        const fields = template.fields.filter(f => f.type === 'table-header');
        return fields.filter(field => {
            const columnData = nodeData[field.id];
            return Array.isArray(columnData) && columnData.some(val => !isValueEmpty(val));
        });
    }, [template.fields, nodeData]);

    const queryFields = useMemo(() => template.fields.filter(f => f.type === 'query'), [template.fields]);

    const tableRowCountMemo = useMemo(() => {
        if (tableHeaderFields.length === 0) return 0;
        const firstColumnData = nodeData[tableHeaderFields[0].id];
        return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
    }, [tableHeaderFields, nodeData]);

    const queriesAndResults = useMemo(() => {
        if (isCompactOverride) return [];
        return queryFields.map(field => {
            const queryDefinitions = nodeData[field.id];
            if (!Array.isArray(queryDefinitions) || queryDefinitions.length === 0) {
                return { field, results: null };
            }

            const combinedResults = new Map<string, TreeNode>();

            queryDefinitions.forEach((queryDef: QueryDefinition) => {
                if (queryDef && queryDef.targetTemplateId) {
                    const results = findNodesByQuery(queryDef);
                    results.forEach(node => combinedResults.set(node.id, node));
                }
            });

            const sortedResults = Array.from(combinedResults.values()).sort((a, b) =>
                (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })
            );

            return { field, results: sortedResults };
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
                                    <RenderWithLinks node={node} template={template} text={template.bodyTemplate} />
                                </div>
                            )}

                            {(() => {
                                const renderSingleField = (field: (typeof template.fields)[number]) => {
                                    const value = nodeData[field.id];

                                    const plugin = FieldRegistry.get(field.type);
                                    if (plugin?.ViewerComponent) {
                                        const Viewer = plugin.ViewerComponent;
                                        return <Viewer key={field.id} field={field} value={value} node={node} readOnly={readOnly} isCompactView={isCompactView} />;
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
                                            if (tableRendered || tableHeaderFields.length === 0) return null;
                                            tableRendered = true;
                                            if (tableRowCountMemo === 0) return null;

                                            return (
                                                <div key="table-block" className="mt-2 text-sm min-w-0" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                    <div className="overflow-x-auto rounded-md border min-w-0">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow className={cn(isCompactView && "h-8")}>
                                                                    {tableHeaderFields.map(field => <TableHead key={field.id} className={cn(isCompactView && "h-8 px-2 text-xs")}>{field.name}</TableHead>)}
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {Array.from({ length: tableRowCountMemo }).map((_, rowIndex) => (
                                                                    <TableRow key={rowIndex} className={cn(isCompactView && "h-8")}>
                                                                        {tableHeaderFields.map(field => {
                                                                            let cellValue = nodeData[field.id]?.[rowIndex] || '';
                                                                            let displayValue = cellValue;

                                                                            if (field.columnType === 'date' && cellValue) {
                                                                                displayValue = formatDate(cellValue, currentUser?.dateFormat);
                                                                            }

                                                                            if (displayValue) {
                                                                                displayValue = `${field.prefix || ''}${displayValue}${field.postfix || ''}`;
                                                                            }

                                                                            return (
                                                                                <TableCell key={field.id} className={cn(isCompactView && "py-1 px-2 text-xs")}>{displayValue}</TableCell>
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
                                            if (!queryResult || !queryResult.results) return null;
                                            const { results } = queryResult;
                                            const queryDefinitions: QueryDefinition[] = Array.isArray(value) ? value : [];

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

                                            return (
                                                <div key={field.id} className="mt-4 pt-2 border-t border-border/40 min-w-0">
                                                    <div className="flex flex-col gap-1 mb-2">
                                                        <p className={cn("text-xs text-muted-foreground/80 bg-muted/40 p-2 rounded border border-border/50 break-words", isCompactView ? "text-[11px]" : "text-xs")}>
                                                            {displayQuery}
                                                        </p>
                                                    </div>

                                                    {/* Results List */}
                                                    <div className="space-y-1 mt-1 pl-1">
                                                        {results.length > 0 ? (
                                                            results.map(resultNode => {
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
                                                            })
                                                        ) : (
                                                            <p className="text-sm text-muted-foreground italic px-2 py-1">Query returned no results.</p>
                                                        )}
                                                    </div>
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
                                            const empty = plugin?.isEmpty ? plugin.isEmpty(value) : isValueEmpty(value);
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
