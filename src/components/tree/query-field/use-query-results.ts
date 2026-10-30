import { useMemo } from "react";
import { Field, TreeNode, QueryDefinition, normalizeQueryFieldValue } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";

export function useQueryNodes(queryDefinitions: QueryDefinition[]): TreeNode[] {
    const { findNodesByQuery } = useTreeContext();

    return useMemo(() => {
        const combinedResults = new Map<string, TreeNode>();

        queryDefinitions.forEach((queryDef: QueryDefinition) => {
            if (queryDef && queryDef.targetTemplateId) {
                const results = findNodesByQuery(queryDef);
                results.forEach(node => combinedResults.set(node.id, node));
            }
        });

        return Array.from(combinedResults.values());
    }, [queryDefinitions, findNodesByQuery]);
}

export function useQueryResults(field: Field, nodeData: Record<string, any>) {
    const { queries: queryDefinitions, displayColumns, sortConfig } = useMemo(
        () => normalizeQueryFieldValue(nodeData[field.id]),
        [field.id, nodeData],
    );
    const nodes = useQueryNodes(queryDefinitions);

    const resultsByTemplate = useMemo(() => {
        // Group results by templateId; sort each group by name.
        const grouped = new Map<string, TreeNode[]>();
        nodes.forEach(resultNode => {
            const tid = resultNode.templateId;
            if (!grouped.has(tid)) grouped.set(tid, []);
            grouped.get(tid)!.push(resultNode);
        });
        grouped.forEach((group) => {
            group.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
        });
        return grouped;
    }, [nodes]);

    return {
        displayColumns,
        sortConfig,
        resultsByTemplate,
        queryDefinitions,
    };
}
