import { TreeNode, TreeFile, Template } from '@/lib/types';
import { getContextualOrder } from '@/lib/utils';

export interface NodeSpec {
  id: string;
  name?: string;
  templateId?: string;
  data?: Record<string, any>;
  isStarred?: boolean;
  userId?: string;
  treeId?: string;
  parentIds?: string[];
  order?: number[];
  children?: NodeSpec[];
  createdAt?: string;
  updatedAt?: string;
}

export function defaultTemplate(): Template {
  return {
    id: 't-default',
    name: 'DefaultTemplate',
    fields: [
      { id: 'f-title', name: 'title', type: 'text' },
      { id: 'f-desc', name: 'desc', type: 'textarea' },
    ],
    conditionalRules: [],
  };
}

export function makeNode(
  spec: NodeSpec,
  contextualParentId: string | null = null,
  treeId: string = 'tree-1',
  userId: string = 'user-1'
): TreeNode {
  const pId = contextualParentId ?? 'root';
  const parentIds = spec.parentIds ? [...spec.parentIds] : [pId];
  let order = spec.order ? [...spec.order] : [0];

  // If order length does not match parentIds length, pad it
  if (order.length < parentIds.length) {
    while (order.length < parentIds.length) {
      order.push(0);
    }
  }

  const node: TreeNode = {
    id: spec.id,
    _id: spec.id,
    name: spec.name ?? `Node ${spec.id}`,
    templateId: spec.templateId ?? 't-default',
    data: spec.data ? JSON.parse(JSON.stringify(spec.data)) : { 'f-title': `Title ${spec.id}` },
    isStarred: spec.isStarred ?? false,
    userId: spec.userId ?? userId,
    treeId: spec.treeId ?? treeId,
    parentIds,
    order,
    children: [],
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
  };

  if (spec.children && spec.children.length > 0) {
    node.children = spec.children.map((childSpec, idx) => {
      return makeNode(childSpec, spec.id, treeId, userId);
    });
  }

  return node;
}

/**
 * Builds realistic denormalized TreeNode[] from specs.
 * Clones (nodes with multiple parentIds) MUST appear as SEPARATE objects under each parent
 * with identical data, without sharing references!
 */
export function makeTree(
  specs: NodeSpec[],
  treeId: string = 'tree-1',
  userId: string = 'user-1',
  title: string = 'Test Tree',
  templates: Template[] = [defaultTemplate()]
): TreeFile {
  // First, recursively build all node instances.
  // Note: if a node has multiple parentIds or appears under multiple parents,
  // we ensure separate objects under each parent.
  const flatSpecs = new Map<string, NodeSpec>();
  const collectSpecs = (list: NodeSpec[]) => {
    for (const s of list) {
      if (!flatSpecs.has(s.id)) {
        flatSpecs.set(s.id, s);
      }
      if (s.children) collectSpecs(s.children);
    }
  };
  collectSpecs(specs);

  const roots: TreeNode[] = specs.map((spec) => makeNode(spec, null, treeId, userId));

  return {
    id: treeId,
    title,
    userId,
    order: 0,
    expandedNodeIds: [],
    templates,
    tree: roots,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Canonical nested representation (id + children, in contextual order) for readable assertions.
 */
export interface DescribedNode {
  id: string;
  name: string;
  order: number;
  children: DescribedNode[];
}

export function describeTree(nodes: TreeNode[], parentId: string | null = null): DescribedNode[] {
  const sorted = [...nodes].sort((a, b) => getContextualOrder(a, nodes, parentId) - getContextualOrder(b, nodes, parentId));
  return sorted.map((n) => ({
    id: n.id,
    name: n.name,
    order: getContextualOrder(n, nodes, parentId),
    children: describeTree(n.children || [], n.id),
  }));
}

/**
 * For every node id that appears more than once, all instances must deep-equal each other ignoring children.
 */
export function assertInstancesConsistent(tree: TreeNode[]): void {
  const instancesById = new Map<string, TreeNode[]>();

  const traverse = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      const list = instancesById.get(node.id) || [];
      list.push(node);
      instancesById.set(node.id, list);
      if (node.children) {
        traverse(node.children);
      }
    }
  };
  traverse(tree);

  for (const [id, instances] of instancesById.entries()) {
    if (instances.length > 1) {
      const first = instances[0];
      const stripChildren = (n: TreeNode) => {
        const { children, ...rest } = n;
        return rest;
      };
      const firstStripped = JSON.stringify(stripChildren(first));
      for (let i = 1; i < instances.length; i++) {
        const otherStripped = JSON.stringify(stripChildren(instances[i]));
        if (firstStripped !== otherStripped) {
          throw new Error(
            `Instances inconsistent for node ${id}:\nInstance 0: ${firstStripped}\nInstance ${i}: ${otherStripped}`
          );
        }
      }
    }
  }
}

/**
 * Map<id, { parentIds, order }> built from the tree, one entry per id (fail if instances disagree).
 */
export function flatPlacements(tree: TreeNode[]): Map<string, { parentIds: string[]; order: number[] }> {
  assertInstancesConsistent(tree);
  const placements = new Map<string, { parentIds: string[]; order: number[] }>();

  const traverse = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (!placements.has(node.id)) {
        placements.set(node.id, {
          parentIds: [...(node.parentIds || [])],
          order: [...(node.order || [])],
        });
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  };
  traverse(tree);
  return placements;
}

/**
 * Set of ids reachable from the roots.
 */
export function reachableIds(tree: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const traverse = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      ids.add(node.id);
      if (node.children) {
        traverse(node.children);
      }
    }
  };
  traverse(tree);
  return ids;
}
