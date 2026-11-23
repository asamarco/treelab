import { TreeNode } from '@/lib/types';
import { getContextualOrder } from '@/lib/utils';
import { WritableDraft } from "immer";

// Local helper function to avoid reference errors.
export const findNodeAndParentInDraft = (nodeId: string, nodes: WritableDraft<TreeNode>[]): { node: WritableDraft<TreeNode>; parent: WritableDraft<TreeNode> | null } | null => {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return { node, parent: null };
    }
    if (node.children) {
      const found = findNodeAndParentInDraft(nodeId, node.children);
      if (found) {
        return { ...found, parent: found.parent || node };
      }
    }
  }
  return null;
};

// Re-creates the nested `children` array structure from a flat list of nodes with `parentIds`.
export const reconstructTree = (nodes: (TreeNode | WritableDraft<TreeNode>)[]): WritableDraft<TreeNode>[] => {
  const nodeMap = new Map<string, WritableDraft<TreeNode>>();
  // First pass: Create a new mutable object for each node to avoid read-only errors.
  nodes.forEach(node => {
    // This spread creates a new object that Immer can safely mutate.
    const mutableNode = { ...node, children: [] } as WritableDraft<TreeNode>;
    nodeMap.set(mutableNode.id, mutableNode);
  });

  const rootNodes: WritableDraft<TreeNode>[] = [];

  // Second pass: Build the hierarchy using object references from our mutable map.
  nodeMap.forEach(node => {
    const parentIds = (node.parentIds && node.parentIds.length > 0) ? node.parentIds : ['root'];

    parentIds.forEach(parentId => {
      if (parentId === 'root') {
        if (!rootNodes.some(rn => rn.id === node.id)) {
          // Push the mutable version from the map
          rootNodes.push(nodeMap.get(node.id)!);
        }
      } else {
        const parent = nodeMap.get(parentId);
        if (parent) {
          if (!parent.children.some(child => child.id === node.id)) {
            // Push the mutable version from the map
            parent.children.push(nodeMap.get(node.id)!);
          }
        }
      }
    });
  });

  const sortChildrenRecursive = (nodesToSort: WritableDraft<TreeNode>[], parentId: string | null) => {
    if (!nodesToSort || nodesToSort.length === 0) return;
    nodesToSort.sort((a, b) => getContextualOrder(a, nodesToSort, parentId) - getContextualOrder(b, nodesToSort, parentId));
    nodesToSort.forEach(node => {
      if (node.children && node.children.length > 0) {
        sortChildrenRecursive(node.children, node.id);
      }
    });
  };

  // Sort all children at every level
  nodeMap.forEach(node => {
    if (node.children) {
      sortChildrenRecursive(node.children, node.id);
    }
  });
  sortChildrenRecursive(rootNodes, null);

  return rootNodes;
};

// Resequences the order property of siblings within an Immer draft.
export const resequenceSiblingsInDraft = (
  siblings: WritableDraft<TreeNode>[],
  parentId: string | null
) => {
  const key = parentId ?? 'root';

  const sortedSiblings = [...siblings].sort((a, b) => getContextualOrder(a, siblings, parentId) - getContextualOrder(b, siblings, parentId));

  sortedSiblings.forEach((sibling, index) => {
    const pIndex = (sibling.parentIds || []).indexOf(key);
    if (pIndex !== -1) {
      const nodeInDraft = siblings.find(s => s.id === sibling.id);
      if (nodeInDraft) {
        const newOrder = [...nodeInDraft.order];
        newOrder[pIndex] = index; // Explicitly set to zero-based index
        nodeInDraft.order = newOrder;
      }
    }
  });
};
