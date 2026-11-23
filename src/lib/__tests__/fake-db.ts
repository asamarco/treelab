import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * fake-db.ts
 *
 * In-memory fake of the data-service functions that node-actions imports.
 * MUST be kept in sync with data-service.ts.
 */

import { TreeNode } from '@/lib/types';
import { assertId, getContextualOrder } from '@/lib/utils';

export interface FakeDbRecord {
  id: string;
  treeId: string;
  userId: string;
  name: string;
  data: Record<string, any>;
  templateId: string;
  isStarred: boolean;
  parentIds: string[];
  order: number[];
  createdAt: string;
  updatedAt: string;
}

export class FakeDatabase {
  public records = new Map<string, FakeDbRecord>();
  public sessionUserId: string | null = 'user-1';
  public calls: { method: string; args: any[] }[] = [];

  /**
   * Depth counter: tracks how many public methods are currently on the call stack.
   * Only outermost (depth === 0) calls are recorded in `calls`, so nested internal
   * calls (e.g. deleteNodeWithChildren called by batchDeleteNodes) are not counted.
   */
  private _als = new AsyncLocalStorage<{ nested: boolean }>();

  constructor() {}

  /**
   * Wraps a public-method body so that only the outermost client-initiated call
   * is recorded in `calls`. Internal calls (nested in the async context) are still
   * executed but not counted as separate round-trips.
   */
  private async _track<T>(method: string, args: any[], fn: () => Promise<T>): Promise<T> {
    const store = this._als.getStore();
    if (!store) {
      this.calls.push({ method, args });
      return this._als.run({ nested: true }, fn);
    }
    return fn();
  }

  public recordCall(method: string, args: any[]) {
    // Legacy shim kept for Test 12 in fake-db.test.ts which calls this directly.
    // All public data-service methods now use _track() instead.
    this.calls.push({ method, args });
  }

  public reset(initialRecords?: FakeDbRecord[]) {
    this.records.clear();
    this.calls = [];
    if (initialRecords) {
      for (const rec of initialRecords) {
        this.records.set(rec.id, JSON.parse(JSON.stringify(rec)));
      }
    }
  }

  public seedFromNodes(nodes: TreeNode[], treeId: string = 'tree-1', userId: string = 'user-1') {
    const flatten = (list: TreeNode[]) => {
      for (const n of list) {
        if (!this.records.has(n.id)) {
          this.records.set(n.id, {
            id: n.id,
            treeId: n.treeId || treeId,
            userId: n.userId || userId,
            name: n.name,
            data: JSON.parse(JSON.stringify(n.data || {})),
            templateId: n.templateId || 't-default',
            isStarred: !!n.isStarred,
            parentIds: [...(n.parentIds || ['root'])],
            order: [...(n.order || [0])],
            createdAt: n.createdAt || new Date().toISOString(),
            updatedAt: n.updatedAt || new Date().toISOString(),
          });
        }
        if (n.children) {
          flatten(n.children);
        }
      }
    };
    flatten(nodes);
  }

  public requireAuth() {
    if (!this.sessionUserId) {
      throw new Error('Authentication required.');
    }
  }

  public dbPlacements(): Map<string, { parentIds: string[]; order: number[] }> {
    const placements = new Map<string, { parentIds: string[]; order: number[] }>();
    for (const [id, rec] of this.records.entries()) {
      placements.set(id, {
        parentIds: [...rec.parentIds],
        order: [...rec.order],
      });
    }
    return placements;
  }

  // --- Data Service mirrored APIs ---

  public async findNodeById(nodeId: string): Promise<TreeNode | null> {
    return this._track('findNodeById', [nodeId], async () => {
      assertId(nodeId, 'nodeId');
      this.requireAuth();
      const rec = this.records.get(nodeId);
      if (!rec) return null;
      return {
        ...JSON.parse(JSON.stringify(rec)),
        children: [],
      };
    });
  }

  public async createNode(
    nodeData: Omit<TreeNode, 'id' | 'children'> & { _id?: string; id?: string }
  ): Promise<TreeNode> {
    return this._track('createNode', [nodeData], async () => {
      assertId(nodeData?.treeId, 'treeId');
      this.requireAuth();
      const id = nodeData.id || nodeData._id || `node-${this.records.size + 1}`;
      assertId(id, 'id');

      // Deliberate fixture guards, not server behavior: real code does not default or validate these here
      if (nodeData.name === undefined || nodeData.name === null) throw new Error('name is required');
      if (!nodeData.templateId) throw new Error('templateId is required');
      const newTimestamp = new Date().toISOString();
      const rec: FakeDbRecord = {
        id,
        treeId: nodeData.treeId,
        userId: this.sessionUserId!,
        name: nodeData.name,
        data: JSON.parse(JSON.stringify(nodeData.data || {})),
        templateId: nodeData.templateId,
        isStarred: !!nodeData.isStarred,
        parentIds: Array.isArray(nodeData.parentIds) ? [...nodeData.parentIds] : ['root'],
        order: Array.isArray(nodeData.order) ? [...nodeData.order] : [0],
        createdAt: newTimestamp,
        updatedAt: newTimestamp,
      };
      this.records.set(id, rec);
      return {
        ...JSON.parse(JSON.stringify(rec)),
        children: [],
      };
    });
  }

  public async updateNode(
    nodeId: string,
    updates: Partial<Omit<TreeNode, 'id' | 'children'>>,
    timestamp?: string
  ): Promise<string> {
    return this._track('updateNode', [nodeId, updates, timestamp], async () => {
      assertId(nodeId, 'nodeId');
      this.requireAuth();
      const rec = this.records.get(nodeId);
      if (!rec) throw new Error('Node not found for update.');

      const newTimestamp = timestamp || new Date().toISOString();
      const { name, data, templateId, isStarred, parentIds, order } = updates as any;

      if (name !== undefined) rec.name = name;
      if (data !== undefined) rec.data = JSON.parse(JSON.stringify(data));
      if (templateId !== undefined) rec.templateId = templateId;
      if (isStarred !== undefined) rec.isStarred = isStarred;
      if (parentIds !== undefined) rec.parentIds = [...parentIds];
      if (order !== undefined) rec.order = [...order];
      rec.updatedAt = newTimestamp;

      return newTimestamp;
    });
  }

  public async resequenceSiblings(parentId: string | null, treeId: string): Promise<void> {
    return this._track('resequenceSiblings', [parentId, treeId], async () => {
      assertId(treeId, 'treeId');
      if (parentId) assertId(parentId, 'parentId');
      this.requireAuth();

      const parentIdToUpdate = parentId || 'root';
      const siblings: FakeDbRecord[] = [];
      for (const rec of this.records.values()) {
        if (rec.treeId === treeId) {
          if (parentIdToUpdate === 'root') {
            if (!rec.parentIds || rec.parentIds.length === 0 || rec.parentIds.includes('root')) {
              siblings.push(rec);
            }
          } else {
            if (rec.parentIds.includes(parentIdToUpdate)) {
              siblings.push(rec);
            }
          }
        }
      }

      if (siblings.length === 0) return;

      const getOrder = (rec: FakeDbRecord) => {
        const idx = rec.parentIds.indexOf(parentIdToUpdate);
        return idx !== -1 ? rec.order[idx] : 0;
      };

      siblings.sort((a, b) => getOrder(a) - getOrder(b));

      siblings.forEach((sibling, index) => {
        const pIdx = sibling.parentIds.indexOf(parentIdToUpdate);
        if (pIdx !== -1) {
          sibling.order[pIdx] = index;
        }
      });
    });
  }

  public async deleteNodeWithChildren(
    nodeId: string,
    parentIdToUnlink: string | null,
    timestamp?: string
  ): Promise<{ deletedIds: string[]; newTimestamp: string }> {
    return this._track('deleteNodeWithChildren', [nodeId, parentIdToUnlink, timestamp], async () => {
      assertId(nodeId, 'nodeId');
      if (parentIdToUnlink) assertId(parentIdToUnlink, 'parentIdToUnlink');
      this.requireAuth();

      const node = this.records.get(nodeId);
      if (!node) return { deletedIds: [], newTimestamp: timestamp || new Date().toISOString() };

      const parentId = parentIdToUnlink ?? 'root';
      const newTimestamp = timestamp || new Date().toISOString();

      // If node has multiple parents, only unlink
      if (node.parentIds.length > 1) {
        const parentIndex = node.parentIds.indexOf(parentId);
        if (parentIndex > -1) {
          node.parentIds.splice(parentIndex, 1);
          node.order.splice(parentIndex, 1);
          node.updatedAt = newTimestamp;
          await this.resequenceSiblings(parentId === 'root' ? null : parentId, node.treeId);
        }
        return { deletedIds: [], newTimestamp };
      }

      // Last instance deleted: delete node and cascade children
      const deletedIds: string[] = [];
      const parentsToResequence = new Set<string | null>(
        node.parentIds.length > 0 ? node.parentIds : [null]
      );

      const findChildrenAndUnlinkOrDelete = async (id: string) => {
        // Find all nodes where parentIds contains id
        const children: FakeDbRecord[] = [];
        for (const rec of this.records.values()) {
          if (rec.parentIds.includes(id)) {
            children.push(rec);
          }
        }

        for (const child of children) {
          if (child.parentIds.length === 1 && child.parentIds[0] === id) {
            deletedIds.push(child.id);
            this.records.delete(child.id);
            await findChildrenAndUnlinkOrDelete(child.id);
          } else {
            const idx = child.parentIds.indexOf(id);
            if (idx !== -1) {
              child.parentIds.splice(idx, 1);
              child.order.splice(idx, 1);
              child.updatedAt = newTimestamp;
            }
          }
        }
      };

      deletedIds.push(node.id);
      this.records.delete(node.id);
      await findChildrenAndUnlinkOrDelete(node.id);

      for (const pid of parentsToResequence) {
        await this.resequenceSiblings(pid === 'root' ? null : pid, node.treeId);
      }

      return { deletedIds, newTimestamp };
    });
  }

  public async batchDeleteNodes(
    deletions: { nodeId: string; parentIdToUnlink: string | null }[],
    timestamp?: string
  ): Promise<{ deletedIds: string[]; newTimestamp: string }> {
    return this._track('batchDeleteNodes', [deletions, timestamp], async () => {
      if (!Array.isArray(deletions) || deletions.length === 0) {
        return { deletedIds: [], newTimestamp: timestamp || new Date().toISOString() };
      }

      deletions.forEach((d) => {
        assertId(d?.nodeId, 'nodeId');
        if (d?.parentIdToUnlink) assertId(d.parentIdToUnlink, 'parentIdToUnlink');
      });

      const allDeletedIds: string[] = [];
      const newTimestamp = timestamp || new Date().toISOString();

      for (const { nodeId, parentIdToUnlink } of deletions) {
        const { deletedIds } = await this.deleteNodeWithChildren(nodeId, parentIdToUnlink, newTimestamp);
        allDeletedIds.push(...deletedIds);
      }

      return { deletedIds: Array.from(new Set(allDeletedIds)), newTimestamp };
    });
  }

  public async reorderSiblingsForAdd(
    treeId: string,
    parentId: string | null,
    order: number,
    timestamp?: string
  ): Promise<void> {
    return this._track('reorderSiblingsForAdd', [treeId, parentId, order, timestamp], async () => {
      assertId(treeId, 'treeId');
      if (parentId) assertId(parentId, 'parentId');
      this.requireAuth();

      const parentIdToUpdate = parentId || 'root';
      for (const rec of this.records.values()) {
        if (rec.treeId === treeId && rec.parentIds.includes(parentIdToUpdate)) {
          const parentIndex = rec.parentIds.indexOf(parentIdToUpdate);
          if (parentIndex !== -1 && rec.order[parentIndex] >= order) {
            rec.order[parentIndex]++;
            rec.updatedAt = timestamp || new Date().toISOString();
          }
        }
      }
    });
  }

  public async batchCreateNodes(
    nodes: Partial<Omit<TreeNode, 'id' | 'children' | '_id'>>[],
    timestamp?: string
  ): Promise<{ createdNodes: TreeNode[]; newTimestamp: string }> {
    return this._track('batchCreateNodes', [nodes, timestamp], async () => {
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return { createdNodes: [], newTimestamp: timestamp || new Date().toISOString() };
      }

      const treeId = nodes[0]?.treeId;
      if (!treeId) throw new Error('Batch create requires nodes to have a treeId.');
      assertId(treeId, 'treeId');

      for (const n of nodes) {
        if (!n || n.treeId !== treeId) {
          throw new Error('Batch create nodes must all share the same authorized treeId.');
        }
      }

      this.requireAuth();
      const newTimestamp = timestamp || new Date().toISOString();

      const createdNodes: TreeNode[] = [];
      for (const n of nodes) {
        const { id, _id, name, data, templateId, isStarred, parentIds, order } = n as any;
        const docId = id || _id;
        if (docId) assertId(docId, 'nodeId');
        const finalId = docId || `node-${this.records.size + 1}`;

        // Deliberate fixture guards, not server behavior: real code does not default or validate these here
        if (name === undefined || name === null) throw new Error('name is required');
        if (!templateId) throw new Error('templateId is required');
        const rec: FakeDbRecord = {
          id: finalId,
          treeId,
          userId: this.sessionUserId!,
          name,
          data: JSON.parse(JSON.stringify(data || {})),
          templateId,
          isStarred: !!isStarred,
          parentIds: Array.isArray(parentIds) ? [...parentIds] : ['root'],
          order: Array.isArray(order) ? [...order] : [0],
          createdAt: newTimestamp,
          updatedAt: newTimestamp,
        };

        this.records.set(finalId, rec);
        createdNodes.push({
          ...JSON.parse(JSON.stringify(rec)),
          children: [],
        });
      }

      return { createdNodes, newTimestamp };
    });
  }

  public async batchUpdateNodes(
    updates: { id: string; updates: Partial<TreeNode> }[],
    timestamp?: string
  ): Promise<string> {
    return this._track('batchUpdateNodes', [updates, timestamp], async () => {
      if (!Array.isArray(updates) || updates.length === 0) return timestamp || new Date().toISOString();
      updates.forEach((u) => assertId(u?.id, 'nodeId'));
      this.requireAuth();

      const newTimestamp = timestamp || new Date().toISOString();
      for (const { id, updates: nodeUpdates } of updates) {
        const rec = this.records.get(id);
        if (rec) {
          const { name, data, templateId, isStarred, parentIds, order } = nodeUpdates as any;
          if (name !== undefined) rec.name = name;
          if (data !== undefined) rec.data = JSON.parse(JSON.stringify(data));
          if (templateId !== undefined) rec.templateId = templateId;
          if (isStarred !== undefined) rec.isStarred = isStarred;
          if (parentIds !== undefined) rec.parentIds = [...parentIds];
          if (order !== undefined) rec.order = [...order];
          rec.updatedAt = newTimestamp;
        }
      }
      return newTimestamp;
    });
  }

  public async addParentToNode(
    nodeId: string,
    newParentId: string | null,
    newOrder: number,
    timestamp?: string
  ): Promise<string> {
    return this._track('addParentToNode', [nodeId, newParentId, newOrder, timestamp], async () => {
      assertId(nodeId, 'nodeId');
      if (newParentId) assertId(newParentId, 'newParentId');
      this.requireAuth();

      const node = this.records.get(nodeId);
      if (!node) throw new Error('Node to clone not found');

      const parentIdToAdd = newParentId || 'root';
      const newTimestamp = timestamp || new Date().toISOString();

      if (!node.parentIds.includes(parentIdToAdd)) {
        node.parentIds.push(parentIdToAdd);
        node.order.push(newOrder);
        node.updatedAt = newTimestamp;
      } else {
        const parentIndex = node.parentIds.indexOf(parentIdToAdd);
        if (parentIndex !== -1) {
          node.order[parentIndex] = newOrder;
          node.updatedAt = newTimestamp;
        }
      }
      return newTimestamp;
    });
  }

  public async removeParentFromNode(
    nodeId: string,
    parentIdToRemove: string,
    timestamp?: string
  ): Promise<string> {
    return this._track('removeParentFromNode', [nodeId, parentIdToRemove, timestamp], async () => {
      // In real data-service.ts:
      // assertId(nodeId, 'nodeId');
      // assertId(parentIdToRemove, 'parentIdToRemove');
      // Calling with null/undefined/'' THROWS because assertId expects non-empty string!
      assertId(nodeId, 'nodeId');
      assertId(parentIdToRemove, 'parentIdToRemove');
      this.requireAuth();

      const node = this.records.get(nodeId);
      if (!node) throw new Error('Node not found for unlinking.');

      const parentIdString = parentIdToRemove || 'root';
      const newTimestamp = timestamp || new Date().toISOString();
      const parentIndex = node.parentIds.indexOf(parentIdString);

      if (parentIndex > -1) {
        node.parentIds.splice(parentIndex, 1);
        node.order.splice(parentIndex, 1);
        node.updatedAt = newTimestamp;
        await this.resequenceSiblings(parentIdString === 'root' ? null : parentIdString, node.treeId);
      }

      return newTimestamp;
    });
  }
}

// Global fake DB instance for tests
export const fakeDb = new FakeDatabase();
