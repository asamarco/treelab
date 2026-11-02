import type { NodeShortcut, TreeNode } from "@/lib/types";

export const SHORTCUT_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

export const MAX_NODE_SHORTCUTS = 1000;
const MAX_ID_LENGTH = 128;

export function isShortcutKey(value: unknown): value is ShortcutKey {
    return typeof value === "string" && /^[0-9]$/.test(value);
}

/** Keeps only well-formed entries, one per (treeId, key), capped in total. Safe for untrusted input. */
export function sanitizeNodeShortcuts(raw: unknown): NodeShortcut[] {
    if (!Array.isArray(raw)) return [];
    const seenSlots = new Set<string>();
    const result: NodeShortcut[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const { treeId, key, nodeId } = entry as Record<string, unknown>;
        if (!isShortcutKey(key) || typeof treeId !== "string" || typeof nodeId !== "string") continue;
        if (!treeId || !nodeId || treeId.length > MAX_ID_LENGTH || nodeId.length > MAX_ID_LENGTH) continue;
        const slotId = JSON.stringify([treeId, key]);
        if (seenSlots.has(slotId)) continue;
        seenSlots.add(slotId);
        result.push({ treeId, key, nodeId });
        if (result.length >= MAX_NODE_SHORTCUTS) break;
    }
    return result;
}

export function getShortcutsForTree(all: NodeShortcut[] | undefined, treeId: string | undefined): NodeShortcut[] {
    if (!all || !treeId) return [];
    return all.filter(shortcut => shortcut.treeId === treeId);
}

export function getShortcutForSlot(
    all: NodeShortcut[] | undefined,
    treeId: string,
    key: ShortcutKey,
): NodeShortcut | undefined {
    return all?.find(shortcut => shortcut.treeId === treeId && shortcut.key === key);
}

/** Replaces whatever the slot held. Returns null when the total cap would be exceeded. */
export function assignShortcut(
    all: NodeShortcut[] | undefined,
    treeId: string,
    key: ShortcutKey,
    nodeId: string,
): NodeShortcut[] | null {
    const others = clearShortcut(all, treeId, key);
    if (others.length >= MAX_NODE_SHORTCUTS) return null;
    return [...others, { treeId, key, nodeId }];
}

export function clearShortcut(all: NodeShortcut[] | undefined, treeId: string, key: ShortcutKey): NodeShortcut[] {
    return (all ?? []).filter(shortcut => !(shortcut.treeId === treeId && shortcut.key === key));
}

export function clearNodeShortcuts(all: NodeShortcut[] | undefined, treeId: string, nodeId: string): NodeShortcut[] {
    return (all ?? []).filter(shortcut => !(shortcut.treeId === treeId && shortcut.nodeId === nodeId));
}

/** Tree-file form of a slot: the tree id is implied by the file it lives in. */
export interface ShortcutHint {
    key: string;
    nodeId: string;
}

export function getShortcutHintsForTree(all: NodeShortcut[] | undefined, treeId: string | undefined): ShortcutHint[] {
    return getShortcutsForTree(all, treeId).map(({ key, nodeId }) => ({ key, nodeId }));
}

/**
 * Maps hints from a tree file onto freshly created nodes. Invalid input yields no shortcuts and never throws.
 * When a key appears more than once, the last entry wins.
 */
export function remapShortcutHints(
    hints: unknown,
    idMap: ReadonlyMap<string, string>,
    newTreeId: string,
): NodeShortcut[] {
    if (!Array.isArray(hints) || hints.length > SHORTCUT_KEYS.length) return [];
    const byKey = new Map<ShortcutKey, NodeShortcut>();
    for (const hint of hints) {
        if (!hint || typeof hint !== "object") continue;
        const { key, nodeId } = hint as Record<string, unknown>;
        if (!isShortcutKey(key) || typeof nodeId !== "string") continue;
        const newNodeId = idMap.get(nodeId);
        if (!newNodeId) continue;
        byKey.set(key, { treeId: newTreeId, key, nodeId: newNodeId });
    }
    return [...byKey.values()];
}

/**
 * Resolves a slot against the full tree via `findNode`, not a filtered view.
 * Returns null for empty slots and for slots whose node no longer exists.
 */
export function resolveShortcutNode(
    all: NodeShortcut[] | undefined,
    treeId: string,
    key: ShortcutKey,
    findNode: (nodeId: string) => TreeNode | null,
): TreeNode | null {
    const slot = getShortcutForSlot(all, treeId, key);
    return slot ? findNode(slot.nodeId) : null;
}
