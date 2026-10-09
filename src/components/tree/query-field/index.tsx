import React, { useState } from "react";
import { Field, TreeNode, Template, normalizeQueryFieldValue } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";
import { useAuthContext } from "@/contexts/auth-context";
import { useQueryResults } from "./use-query-results";
import { describeQuery } from "./query-description";
import { QueryResultTable } from "./table-view";
import { buildMergedTableGroups, MergedTableGroup, getColumnMergeKey } from "./merge-templates";
import { cn } from "@/lib/utils";

export interface QueryFieldViewProps {
    field: Field;
    node: TreeNode;
    template: Template;
    isCompactView: boolean;
}

export function QueryFieldView({ field, node, isCompactView }: QueryFieldViewProps) {
    const { getTemplateById, updateNode } = useTreeContext();
    const { currentUser } = useAuthContext();

    const nodeData = node.data || {};
    const { displayColumns, sortConfig, resultsByTemplate, queryDefinitions } = useQueryResults(field, nodeData);

    // Pagination state keyed by groupKey (stable across re-renders)
    const [pageByGroup, setPageByGroup] = useState<Record<string, number>>({});

    const getPage = (groupKey: string) => pageByGroup[groupKey] ?? 0;
    const setPage = (groupKey: string, page: number) => {
        setPageByGroup(prev => ({ ...prev, [groupKey]: page }));
    };

    /**
     * Resolve the active sort config for a group.
     * Checks each member templateId in order; returns the first non-null entry found.
     */
    const resolveGroupSort = (
        group: MergedTableGroup,
    ): { columnId: string; direction: 'asc' | 'desc' } | null => {
        for (const tid of group.templateIds) {
            const cfg = sortConfig[tid];
            if (cfg != null) return cfg;
        }
        return null;
    };

    /**
     * When the user changes sort on a merged table, write the new config back
     * to ALL member templateIds so sort state stays consistent if grouping changes later.
     */
    const handleSortChange = (
        group: MergedTableGroup,
        newConfig: { columnId: string; direction: 'asc' | 'desc' } | null,
    ) => {
        if (!updateNode) return;
        const currentRaw = nodeData[field.id];
        const normalized = normalizeQueryFieldValue(currentRaw);
        const updatedSortConfig = { ...normalized.sortConfig };
        for (const tid of group.templateIds) {
            updatedSortConfig[tid] = newConfig;
        }
        const updatedFieldValue = {
            ...normalized,
            sortConfig: updatedSortConfig,
        };
        updateNode(node.id, {
            data: {
                ...nodeData,
                [field.id]: updatedFieldValue,
            },
        });
        setPage(group.groupKey, 0);
    };

    /** Sort the nodes of a group according to the active sort config. */
    const sortGroupNodes = (group: MergedTableGroup, activeSort: { columnId: string; direction: 'asc' | 'desc' } | null): TreeNode[] => {
        if (!activeSort) return group.nodes;

        const { columnId, direction } = activeSort;
        const dirMult = direction === 'desc' ? -1 : 1;

        return [...group.nodes].sort((a, b) => {
            // ── Name column ──────────────────────────────────────────────────
            if (columnId === '__name') {
                return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }) * dirMult;
            }
            if (columnId === '__createdAt') {
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : NaN;
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
                const isInvalidA = isNaN(dateA);
                const isInvalidB = isNaN(dateB);
                if (isInvalidA && isInvalidB) return 0;
                if (isInvalidA) return 1;
                if (isInvalidB) return -1;
                return (dateA - dateB) * dirMult;
            }
            if (columnId === '__updatedAt') {
                const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : NaN;
                const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : NaN;
                const isInvalidA = isNaN(dateA);
                const isInvalidB = isNaN(dateB);
                if (isInvalidA && isInvalidB) return 0;
                if (isInvalidA) return 1;
                if (isInvalidB) return -1;
                return (dateA - dateB) * dirMult;
            }

            // ── Data column — resolved per-row via the row's own template ───
            // The columnId is the merge key; find the matching column definition in the group
            const col = group.columns.find(c => getColumnMergeKey(c.name, c.type) === columnId);
            if (!col) return 0;

            const targetKey = getColumnMergeKey(col.name, col.type);

            const getValueForNode = (n: TreeNode) => {
                if (col.type === 'date') {
                    const normName = col.name.trim().toLowerCase();
                    if (normName === 'created') return n.createdAt;
                    if (normName === 'last edited') return n.updatedAt;
                }
                const tpl = getTemplateById(n.templateId);
                const f = tpl?.fields.find(
                    field => getColumnMergeKey(field.name, field.type) === targetKey,
                );
                return f ? n.data?.[f.id] : undefined;
            };

            const valA = getValueForNode(a);
            const valB = getValueForNode(b);

            switch (col.type) {
                case 'text':
                case 'textarea':
                case 'link':
                case 'dropdown':
                case 'dynamic-dropdown': {
                    const strA = valA != null ? String(valA) : '';
                    const strB = valB != null ? String(valB) : '';
                    return strA.localeCompare(strB, undefined, { sensitivity: 'base' }) * dirMult;
                }
                case 'number': {
                    const numA = valA !== '' && valA != null ? Number(valA) : NaN;
                    const numB = valB !== '' && valB != null ? Number(valB) : NaN;
                    const isInvalidA = isNaN(numA);
                    const isInvalidB = isNaN(numB);
                    if (isInvalidA && isInvalidB) return 0;
                    if (isInvalidA) return 1;  // missing sorts last regardless of direction
                    if (isInvalidB) return -1;
                    return (numA - numB) * dirMult;
                }
                case 'date': {
                    const dateA = valA ? new Date(valA).getTime() : NaN;
                    const dateB = valB ? new Date(valB).getTime() : NaN;
                    const isInvalidA = isNaN(dateA);
                    const isInvalidB = isNaN(dateB);
                    if (isInvalidA && isInvalidB) return 0;
                    if (isInvalidA) return 1;  // missing dates sort last regardless of direction
                    if (isInvalidB) return -1;
                    return (dateA - dateB) * dirMult;
                }
                case 'checkbox': {
                    const boolA = !!valA;
                    const boolB = !!valB;
                    if (boolA === boolB) return 0;
                    const cmp = boolA ? 1 : -1; // false before true for ascending
                    return cmp * dirMult;
                }
                default:
                    return 0;
            }
        });
    };

    const displayQuery = describeQuery(queryDefinitions, getTemplateById);
    const totalResults = Array.from(resultsByTemplate.values()).reduce((sum, nodes) => sum + nodes.length, 0);

    const groups = buildMergedTableGroups(resultsByTemplate, displayColumns, getTemplateById);

    return (
        <div className="mt-4 pt-2 border-t border-border/40 min-w-0">
            <div className="flex flex-col gap-1 mb-2">
                <p className={cn("text-xs text-muted-foreground/80 bg-muted/40 p-2 rounded border border-border/50 break-words", isCompactView ? "text-[11px]" : "text-xs")}>
                    {displayQuery}
                </p>
            </div>

            {totalResults === 0 ? (
                <p className="text-sm text-muted-foreground italic px-2 py-1">Query returned no results.</p>
            ) : (
                <div className="space-y-4 mt-1">
                    {groups.map(group => {
                        const activeSort = resolveGroupSort(group);
                        const sortedNodes = sortGroupNodes(group, activeSort);
                        const sortedGroup = { ...group, nodes: sortedNodes };

                        return (
                            <QueryResultTable
                                key={group.groupKey}
                                group={sortedGroup}
                                isCompactView={isCompactView}
                                dateFormat={currentUser?.dateFormat}
                                page={getPage(group.groupKey)}
                                onPageChange={(page) => setPage(group.groupKey, page)}
                                sortConfig={activeSort}
                                onSortChange={(config) => handleSortChange(group, config)}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
