import { Field, Template, TreeNode } from "@/lib/types";
import { QUERY_COLUMN_FIELD_TYPES, VIRTUAL_QUERY_COLUMNS } from "./constants";

const TEXT_LIKE_TYPES: Field['type'][] = ['text', 'textarea', 'dropdown', 'dynamic-dropdown'];

export function getMergeTypeClass(type: Field['type']): string {
    return TEXT_LIKE_TYPES.includes(type) ? 'text-like' : type;
}

export function getColumnMergeKey(name: string, type: Field['type']): string {
    return `${name.trim().toLowerCase()}|${getMergeTypeClass(type)}`;
}

export interface MergedTableGroup {
    /** Stable key derived from sorted templateIds — used as React key and for pagination/sort state. */
    groupKey: string;
    templateIds: string[];
    /** Ordered union of distinct column merge keys across the group, in first-encountered order. */
    columns: { name: string; type: Field['type'] }[];
    /** All result nodes from every template in the group, combined (unsorted). */
    nodes: TreeNode[];
}

/**
 * Given query results grouped by templateId, compute merged table groups.
 *
 * Two templates belong in the same group when their selected displayColumns contain
 * at least one column pair with the same column merge key. Grouping is transitive (connected components via union-find).
 *
 * Templates that share no column with any other template still produce a single-element
 * MergedTableGroup (templateIds.length === 1), keeping the rendering loop uniform.
 */
export function buildMergedTableGroups(
    resultsByTemplate: Map<string, TreeNode[]>,
    displayColumns: Record<string, string[]>,
    getTemplateById: (id: string) => Template | undefined,
): MergedTableGroup[] {
    const templateIds = Array.from(resultsByTemplate.keys());

    if (templateIds.length === 0) return [];

    // ── 1. Resolve each template's selected columns to {name, type} pairs ──────

    const colsByTemplate = new Map<string, { name: string; type: Field['type']; key: string }[]>();

    for (const tid of templateIds) {
        const tpl = getTemplateById(tid);
        const rawColIds = displayColumns[tid] ?? [];
        const cols = rawColIds
            .map(colId => {
                const vCol = VIRTUAL_QUERY_COLUMNS.find(v => v.id === colId);
                if (vCol) {
                    return { name: vCol.name, type: vCol.type };
                }
                const f = tpl?.fields.find(field => field.id === colId);
                if (f && QUERY_COLUMN_FIELD_TYPES.includes(f.type)) {
                    return { name: f.name, type: f.type };
                }
                return null;
            })
            .filter((c): c is { name: string; type: Field['type'] } => c != null)
            .map(c => ({ name: c.name, type: c.type, key: getColumnMergeKey(c.name, c.type) }));
        colsByTemplate.set(tid, cols);
    }

    // ── 2. Union-Find ──────────────────────────────────────────────────────────

    const parent = new Map<string, string>(templateIds.map(id => [id, id]));

    function find(x: string): string {
        if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
        return parent.get(x)!;
    }

    function union(x: string, y: string) {
        const rx = find(x), ry = find(y);
        if (rx !== ry) parent.set(rx, ry);
    }

    // Build an index: mergeKey → templateIds that have that column
    const keyToTemplates = new Map<string, string[]>();
    for (const [tid, cols] of colsByTemplate) {
        for (const col of cols) {
            if (!keyToTemplates.has(col.key)) keyToTemplates.set(col.key, []);
            keyToTemplates.get(col.key)!.push(tid);
        }
    }

    // Connect templates that share at least one column key
    for (const ids of keyToTemplates.values()) {
        for (let i = 1; i < ids.length; i++) {
            union(ids[0], ids[i]);
        }
    }

    // ── 3. Build connected components ─────────────────────────────────────────

    const components = new Map<string, string[]>(); // root → member templateIds
    for (const tid of templateIds) {
        const root = find(tid);
        if (!components.has(root)) components.set(root, []);
        components.get(root)!.push(tid);
    }

    // ── 4. Build MergedTableGroup for each component ──────────────────────────

    const groups: MergedTableGroup[] = [];

    for (const [, members] of components) {
        // stable groupKey: sorted templateIds joined
        const groupKey = [...members].sort().join('|');

        // ordered column union (first-encountered, deduped by getColumnMergeKey)
        const seenKeys = new Set<string>();
        const columns: { name: string; type: Field['type'] }[] = [];
        for (const tid of members) {
            for (const col of colsByTemplate.get(tid) ?? []) {
                if (!seenKeys.has(col.key)) {
                    seenKeys.add(col.key);
                    columns.push({ name: col.name, type: col.type });
                }
            }
        }

        // combined nodes (unsorted — sorting is applied in index.tsx)
        const nodes: TreeNode[] = [];
        for (const tid of members) {
            nodes.push(...(resultsByTemplate.get(tid) ?? []));
        }

        groups.push({ groupKey, templateIds: members, columns, nodes });
    }

    return groups;
}
