import React from "react";
import { TreeNode } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Icon } from "@/components/icon";
import { Crosshair, ArrowUp, ArrowDown } from "lucide-react";
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { getConditionalStyle } from "../tree-node-utils";
import { formatMergedCellValue } from "./format-cell-value";
import { QUERY_PAGE_SIZE } from "./constants";
import { MergedTableGroup, getColumnMergeKey } from "./merge-templates";
import { cn } from "@/lib/utils";

export interface QueryResultTableProps {
    group: MergedTableGroup;
    isCompactView: boolean;
    dateFormat?: string;
    page: number;
    onPageChange: (page: number) => void;
    /** columnId is '__name' (or sentinel) for virtual/name columns, or getColumnMergeKey(col.name, col.type) for data columns. */
    sortConfig: { columnId: string; direction: 'asc' | 'desc' } | null;
    onSortChange: (config: { columnId: string; direction: 'asc' | 'desc' } | null) => void;
}

/** @deprecated Use QueryResultTableProps / QueryResultTable instead. */
export type QueryTemplateTableProps = QueryResultTableProps;

export function QueryResultTable({
    group,
    isCompactView,
    dateFormat,
    page,
    onPageChange,
    sortConfig,
    onSortChange,
}: QueryResultTableProps) {
    const { getTemplateById, selectAndCenterNode, findNodeAndParent } = useTreeContext();
    const { setDialogState, dialogState } = useUIContext();

    const clickTimerRef = React.useRef<NodeJS.Timeout | null>(null);
    const lastClickedIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        return () => {
            if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
            }
        };
    }, []);

    const handleRowClick = (e: React.MouseEvent, resultNode: TreeNode) => {
        e.stopPropagation();

        if (clickTimerRef.current && lastClickedIdRef.current === resultNode.id) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
            lastClickedIdRef.current = null;

            const parentInfo = findNodeAndParent ? findNodeAndParent(resultNode.id) : null;
            const instanceId = `${resultNode.id}_${parentInfo?.parent?.id || 'root'}`;
            const currentIds = dialogState.openNodeEditInstanceIds || [];
            if (!currentIds.includes(instanceId)) {
                setDialogState({ openNodeEditInstanceIds: [...currentIds, instanceId] });
            }
        } else {
            if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
            }
            lastClickedIdRef.current = resultNode.id;
            clickTimerRef.current = setTimeout(() => {
                setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [resultNode.id] });
                clickTimerRef.current = null;
                lastClickedIdRef.current = null;
            }, 250);
        }
    };

    const isMultiTemplate = group.templateIds.length > 1;

    // For single-template groups, use the template name as the label.
    // For multi-template groups we show per-row badges instead.
    const singleTemplateLabel = !isMultiTemplate
        ? (getTemplateById(group.templateIds[0])?.name ?? group.templateIds[0])
        : null;

    const pageStart = page * QUERY_PAGE_SIZE;
    const pageEnd = pageStart + QUERY_PAGE_SIZE;
    const pageNodes = group.nodes.slice(pageStart, pageEnd);
    const totalPages = Math.ceil(group.nodes.length / QUERY_PAGE_SIZE);

    const handleHeaderClick = (columnId: string) => {
        if (sortConfig?.columnId === columnId) {
            if (sortConfig.direction === 'asc') {
                onSortChange({ columnId, direction: 'desc' });
            } else {
                onSortChange(null);
            }
        } else {
            onSortChange({ columnId, direction: 'asc' });
        }
    };

    const renderSortIcon = (columnId: string) => {
        if (sortConfig?.columnId !== columnId) return null;
        if (sortConfig.direction === 'asc') {
            return <ArrowUp className="h-3 w-3 inline ml-1 shrink-0" />;
        }
        return <ArrowDown className="h-3 w-3 inline ml-1 shrink-0" />;
    };

    const renderListItem = (resultNode: TreeNode) => {
        const resultTemplate = getTemplateById(resultNode.templateId);
        const { icon: resultIcon, color: resultColor } = getConditionalStyle(resultNode, resultTemplate);
        return (
            <div key={resultNode.id} className="flex items-center justify-between gap-2 p-1.5 -ml-1.5 rounded-md hover:bg-accent group/queryresult">
                <div className="flex items-center gap-2 overflow-hidden flex-grow">
                    <div
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={(e) => handleRowClick(e, resultNode)}
                        onDoubleClick={(e) => e.stopPropagation()}
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
        <div className="space-y-1" onDoubleClick={(e) => e.stopPropagation()}>
            {/* Template label — only for single-template groups when there are multiple groups */}
            {singleTemplateLabel != null && (
                <p className={cn("text-xs font-semibold text-muted-foreground uppercase tracking-wide", isCompactView && "text-[10px]")}>
                    {singleTemplateLabel} ({group.nodes.length})
                </p>
            )}

            {/* Multi-template merged group heading */}
            {isMultiTemplate && (
                <p className={cn("text-xs font-semibold text-muted-foreground uppercase tracking-wide", isCompactView && "text-[10px]")}>
                    {group.templateIds.map(tid => getTemplateById(tid)?.name ?? tid).join(' + ')} ({group.nodes.length})
                </p>
            )}

            {group.columns.length === 0 ? (
                // Fallback: plain list (no columns selected yet)
                <div className="space-y-1 pl-1">
                    {pageNodes.map(renderListItem)}
                </div>
            ) : (
                // Table view
                <div className="overflow-x-auto rounded-md border min-w-0" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <Table>
                        <TableHeader>
                            <TableRow className={cn(isCompactView && "h-8")}>
                                <TableHead
                                    className={cn("w-[180px] cursor-pointer select-none", isCompactView && "h-8 px-2 text-xs")}
                                    onClick={() => handleHeaderClick('__name')}
                                >
                                    <div className="flex items-center">
                                        <span>Name</span>
                                        {renderSortIcon('__name')}
                                    </div>
                                </TableHead>
                                {group.columns.map(col => {
                                    const colId = getColumnMergeKey(col.name, col.type);
                                    return (
                                        <TableHead
                                            key={colId}
                                            className={cn("cursor-pointer select-none", isCompactView && "h-8 px-2 text-xs")}
                                            onClick={() => handleHeaderClick(colId)}
                                        >
                                            <div className="flex items-center">
                                                <span>{col.name}</span>
                                                {renderSortIcon(colId)}
                                            </div>
                                        </TableHead>
                                    );
                                })}
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
                                        onClick={(e) => handleRowClick(e, resultNode)}
                                        onDoubleClick={(e) => e.stopPropagation()}
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
                                        {group.columns.map(col => {
                                            const colId = getColumnMergeKey(col.name, col.type);
                                            return (
                                                <TableCell
                                                    key={colId}
                                                    className={cn(isCompactView && "py-1 px-2 text-xs")}
                                                >
                                                    {formatMergedCellValue(resultNode, col.name, col.type, getTemplateById, dateFormat)}
                                                </TableCell>
                                            );
                                        })}
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
                        {pageStart + 1}–{Math.min(pageEnd, group.nodes.length)} of {group.nodes.length}
                    </span>
                    <div className="flex gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={page === 0}
                            onClick={(e) => { e.stopPropagation(); onPageChange(page - 1); }}
                        >
                            ‹
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={page >= totalPages - 1}
                            onClick={(e) => { e.stopPropagation(); onPageChange(page + 1); }}
                        >
                            ›
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

/** @deprecated Use QueryResultTable instead. */
export const QueryTemplateTable = QueryResultTable;
