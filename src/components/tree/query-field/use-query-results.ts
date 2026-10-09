import { useMemo } from "react";
import { Field, TreeNode, QueryDefinition, normalizeQueryFieldValue } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";

export function useQueryResults(field: Field, nodeData: Record<string, any>) {
    const { findNodesByQuery } = useTreeContext();

    return useMemo(() => {
        const rawValue = nodeData[field.id];
        const { queries: queryDefinitions, displayColumns, sortConfig } = normalizeQueryFieldValue(rawValue);

        if (queryDefinitions.length === 0) {
            return {
                displayColumns,
                sortConfig,
                resultsByTemplate: new Map<string, TreeNode[]>(),
                queryDefinitions,
            };
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
            nodes.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
        });

        return {
            displayColumns,
            sortConfig,
            resultsByTemplate,
            queryDefinitions,
        };
    }, [field.id, nodeData, findNodesByQuery]);
}
