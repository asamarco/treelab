import { Field, KanbanFieldValue, Template, TreeNode } from "@/lib/types";
import { findFieldByName, getCardFields } from "@/lib/visualizations/shared";

export type KanbanBoardConfig = Pick<KanbanFieldValue, "groupByFieldName" | "cardFieldNames">;

export const UNASSIGNED_COLUMN_KEY = "__unassigned__";

export interface KanbanColumn {
    key: string;
    label: string;
    nodes: TreeNode[];
}

export interface KanbanIssue {
    nodeId: string;
    reason: "missing-group-field";
}

export interface KanbanColumnsResult {
    columns: KanbanColumn[];
    issues: KanbanIssue[];
}

const valueColumnKey = (value: string) => `v:${value}`;

export function findGroupByField(template: Template | undefined, groupByFieldName: string): Field | undefined {
    return findFieldByName(template, groupByFieldName, "dropdown");
}

function readGroupValue(node: TreeNode, field: Field): string | null {
    const raw = node.data?.[field.id];
    if (typeof raw === "string") return raw === "" ? null : raw;
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return null;
}

export function buildKanbanColumns(
    nodes: TreeNode[],
    templates: Template[],
    config: KanbanBoardConfig,
): KanbanColumnsResult {
    const templateById = new Map(templates.map(t => [t.id, t]));
    const issues: KanbanIssue[] = [];
    const placed: { node: TreeNode; field: Field; value: string | null }[] = [];
    const optionColumns: KanbanColumn[] = [];
    const optionKeys = new Set<string>();
    let optionsResolved = false;

    for (const node of nodes) {
        const template = templateById.get(node.templateId);
        const field = findGroupByField(template, config.groupByFieldName);
        if (!field) {
            issues.push({ nodeId: node.id, reason: "missing-group-field" });
            continue;
        }
        if (!optionsResolved) {
            optionsResolved = true;
            for (const option of field.options ?? []) {
                const key = valueColumnKey(option);
                if (optionKeys.has(key)) continue;
                optionKeys.add(key);
                optionColumns.push({ key, label: option, nodes: [] });
            }
        }
        placed.push({ node, field, value: readGroupValue(node, field) });
    }

    const columnsByKey = new Map<string, KanbanColumn>(optionColumns.map(c => [c.key, c]));
    const extraColumns: KanbanColumn[] = [];
    const unassigned: KanbanColumn = { key: UNASSIGNED_COLUMN_KEY, label: "Unassigned", nodes: [] };

    for (const { node, value } of placed) {
        if (value === null) {
            unassigned.nodes.push(node);
            continue;
        }
        const key = valueColumnKey(value);
        let column = columnsByKey.get(key);
        if (!column) {
            column = { key, label: value, nodes: [] };
            columnsByKey.set(key, column);
            extraColumns.push(column);
        }
        column.nodes.push(node);
    }

    return {
        columns: [...optionColumns, ...extraColumns, unassigned],
        issues,
    };
}

export function getKanbanCardFields(
    template: Template | undefined,
    config: KanbanBoardConfig,
): Field[] {
    const groupByField = findGroupByField(template, config.groupByFieldName);
    return getCardFields(template, config.cardFieldNames, groupByField ? [groupByField.id] : []);
}

/**
 * Returns the data patch that moves a node into the target column, or null when the node
 * cannot move there (its template has no group-by field, or it is already in that column).
 */
export function applyKanbanMove(
    node: TreeNode,
    template: Template | undefined,
    config: KanbanBoardConfig,
    targetColumnKey: string,
): Record<string, string> | null {
    const field = findGroupByField(template, config.groupByFieldName);
    if (!field) return null;

    const current = readGroupValue(node, field);
    const currentKey = current === null ? UNASSIGNED_COLUMN_KEY : valueColumnKey(current);
    if (currentKey === targetColumnKey) return null;

    if (targetColumnKey === UNASSIGNED_COLUMN_KEY) return { [field.id]: "" };
    if (targetColumnKey.startsWith("v:")) return { [field.id]: targetColumnKey.slice(2) };
    return null;
}
