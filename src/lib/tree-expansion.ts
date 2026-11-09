import type { TreeNode } from "@/lib/types";

export function computeExpandedIds(
    items: { node: TreeNode; contextualParentId: string | null }[],
    maxDepth: number,
): string[] {
    const ids = new Set<string>();

    const visit = (node: TreeNode, contextualParentId: string | null, depth: number) => {
        if (depth > maxDepth) return;
        ids.add(`${node.id}_${contextualParentId || 'root'}`);
        if (node.children && depth < maxDepth) {
            for (const child of node.children) {
                visit(child, node.id, depth + 1);
            }
        }
    };

    for (const { node, contextualParentId } of items) {
        visit(node, contextualParentId, 0);
    }

    return Array.from(ids);
}
