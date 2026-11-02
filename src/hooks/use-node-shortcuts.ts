"use client";

import { useCallback, useMemo } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { useToast } from "@/hooks/use-toast";
import {
  assignShortcut,
  clearNodeShortcuts,
  clearShortcut,
  getShortcutForSlot,
  getShortcutsForTree,
  resolveShortcutNode,
  SHORTCUT_KEYS,
  ShortcutKey,
} from "@/lib/node-shortcuts";
import type { TreeNode } from "@/lib/types";

export function useNodeShortcuts() {
  const { currentUser, setNodeShortcuts } = useAuthContext();
  const { activeTree, findNodeAndParent } = useTreeContext();
  const { toast } = useToast();

  const treeId = activeTree?.id;
  const allShortcuts = currentUser?.nodeShortcuts;

  const shortcuts = useMemo(() => getShortcutsForTree(allShortcuts, treeId), [allShortcuts, treeId]);

  const findNode = useCallback(
    (nodeId: string): TreeNode | null => findNodeAndParent(nodeId)?.node ?? null,
    [findNodeAndParent],
  );

  const resolveSlot = useCallback(
    (key: ShortcutKey): TreeNode | null => (treeId ? resolveShortcutNode(allShortcuts, treeId, key, findNode) : null),
    [allShortcuts, treeId, findNode],
  );

  const assignSlot = useCallback((key: ShortcutKey, nodeId: string) => {
    if (!treeId) return;
    const next = assignShortcut(allShortcuts, treeId, key, nodeId);
    if (!next) {
      toast({
        title: "Shortcut limit reached",
        description: "Remove an existing node shortcut before assigning another.",
        variant: "destructive",
      });
      return;
    }
    setNodeShortcuts(next);
  }, [allShortcuts, treeId, setNodeShortcuts, toast]);

  const clearSlot = useCallback((key: ShortcutKey) => {
    if (!treeId || !getShortcutForSlot(allShortcuts, treeId, key)) return;
    setNodeShortcuts(clearShortcut(allShortcuts, treeId, key));
  }, [allShortcuts, treeId, setNodeShortcuts]);

  const clearNode = useCallback((nodeId: string) => {
    if (!treeId) return;
    setNodeShortcuts(clearNodeShortcuts(allShortcuts, treeId, nodeId));
  }, [allShortcuts, treeId, setNodeShortcuts]);

  return {
    treeId,
    shortcuts,
    slotKeys: SHORTCUT_KEYS,
    resolveSlot,
    assignSlot,
    clearSlot,
    clearNode,
    canUse: !!currentUser && !!treeId,
  };
}
