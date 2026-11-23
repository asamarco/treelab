/**
 * ctx.ts
 *
 * Mirrors the ActionContext and helper callbacks built in tree-roots.tsx:
 * nodeMap/findNodeAndParent, findNodeAndContextualParent, isCloneOrDescendant,
 * getSiblingOrderRange, getTemplateById.
 * Captures executed commands for testing.
 */

import { ActionContext, Command, TreeFile, TreeNode, User, Template, ClipboardState } from '@/lib/types';
import { getContextualOrder } from '@/lib/utils';
import { vi } from 'vitest';

export interface CapturedCommandRecord {
  command: Command;
  isUndoable: boolean;
}

export function makeCtx(
  activeTree: TreeFile,
  overrides?: Partial<ActionContext> & {
    allTrees?: TreeFile[];
    captured?: CapturedCommandRecord[];
  }
): ActionContext & { capturedCommands: CapturedCommandRecord[] } {
  const capturedCommands: CapturedCommandRecord[] = overrides?.captured || [];

  const allTrees = overrides?.allTrees || [activeTree];

  const defaultUser: User = {
    id: 'user-1',
    username: 'testuser',
    passwordHash: '',
    salt: '',
    isAdmin: false,
  };

  const currentUser = overrides?.currentUser !== undefined ? overrides.currentUser : defaultUser;

  // Build nodeMap mirroring tree-roots.tsx (lines 299-317)
  const nodeMap = new Map<string, { node: TreeNode; parent: TreeNode | null }>();
  const buildMap = (nodes: TreeNode[], parent: TreeNode | null) => {
    for (const node of nodes) {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, { node, parent });
      }
      if (node.children) {
        buildMap(node.children, node);
      }
    }
  };
  if (activeTree.tree) {
    buildMap(activeTree.tree, null);
  }

  // Mirror tree-roots.tsx findNodeAndParent (lines 319-338)
  const findNodeAndParent = (
    nodeId: string,
    nodes?: TreeNode[]
  ): { node: TreeNode; parent: TreeNode | null } | null => {
    if (!nodes) {
      return nodeMap.get(nodeId) ?? null;
    }

    for (const node of nodes) {
      if (node.id === nodeId) {
        return { node, parent: null };
      }
      if (node.children) {
        const found = findNodeAndParent(nodeId, node.children);
        if (found) {
          return { ...found, parent: found.parent || node };
        }
      }
    }
    return null;
  };

  // Mirror tree-roots.tsx findNodeAndContextualParent (lines 977-989)
  const findNodeAndContextualParent = (
    nodeId: string | null,
    contextualParentId: string | null,
    nodes?: TreeNode[]
  ): { node: TreeNode; parent: TreeNode | null } | null => {
    const searchNodes = nodes || activeTree?.tree;
    if (!searchNodes || !nodeId) return null;

    const nodeInfo = findNodeAndParent(nodeId, searchNodes);
    if (!nodeInfo) return null;

    const contextualParent = contextualParentId
      ? findNodeAndParent(contextualParentId, searchNodes)?.node ?? null
      : null;
    return { node: nodeInfo.node, parent: contextualParent };
  };

  // Mirror tree-roots.tsx isCloneOrDescendant (lines 991-998)
  const isCloneOrDescendant = (nodeId: string, nodes?: TreeNode[]): boolean => {
    const nodeInfo = findNodeAndParent(nodeId, nodes);
    if (!nodeInfo) return false;
    const { node, parent } = nodeInfo;
    if ((node.parentIds || []).length > 1) return true;
    if (parent) return isCloneOrDescendant(parent.id, nodes);
    return false;
  };

  // Mirror tree-roots.tsx getSiblingOrderRange (lines 1000-1010)
  const getSiblingOrderRange = (
    siblings: TreeNode[],
    parentId: string | null
  ): { minOrder: number; maxOrder: number } => {
    if (!siblings || siblings.length === 0) {
      return { minOrder: 0, maxOrder: 0 };
    }
    const orders = siblings.map((s) => getContextualOrder(s, siblings, parentId));
    return {
      minOrder: Math.min(...orders),
      maxOrder: Math.max(...orders),
    };
  };

  const getTemplateById = (id: string): Template | undefined => {
    return activeTree.templates?.find((t) => t.id === id);
  };

  const executeCommand = vi.fn((command: Command, isUndoable: boolean = true) => {
    capturedCommands.push({ command, isUndoable });
  });

  const toast = vi.fn();
  const reloadActiveTree = vi.fn(async () => {});

  const ctx: ActionContext & { capturedCommands: CapturedCommandRecord[] } = {
    activeTree,
    activeTreeId: activeTree.id,
    currentUser,
    allTrees,
    executeCommand,
    findNodeAndParent,
    findNodeAndContextualParent,
    isCloneOrDescendant,
    getSiblingOrderRange,
    getTemplateById,
    toast: toast as any,
    reloadActiveTree,
    clipboard: { nodes: null, operation: null },
    selectedNodeIds: [],
    capturedCommands,
    ...overrides,
  };

  return ctx;
}
