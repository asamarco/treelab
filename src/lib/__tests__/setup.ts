/**
 * setup.ts
 *
 * Vitest mock setup:
 * - Mock '@/lib/data-service' to route everything to fakeDb
 * - Mock generateClientSideId to deterministic counter 'id-1', 'id-2', ...
 */

import { vi, beforeEach } from 'vitest';
import { fakeDb } from './fake-db';

let idCounter = 1;

export function resetIdCounter() {
  idCounter = 1;
}

export function getNextDeterministicId(): string {
  return `id-${idCounter++}`;
}

// Partial mock of '@/lib/utils' replacing generateClientSideId with deterministic counter
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    generateClientSideId: () => getNextDeterministicId(),
  };
});

// Mock '@/lib/data-service' routing to fakeDb
vi.mock('@/lib/data-service', () => {
  return {
    findNodeById: vi.fn((nodeId: string) => fakeDb.findNodeById(nodeId)),
    createNode: vi.fn((nodeData: any) => fakeDb.createNode(nodeData)),
    updateNode: vi.fn((nodeId: string, updates: any, timestamp?: string) =>
      fakeDb.updateNode(nodeId, updates, timestamp)
    ),
    resequenceSiblings: vi.fn((parentId: string | null, treeId: string) =>
      fakeDb.resequenceSiblings(parentId, treeId)
    ),
    deleteNodeWithChildren: vi.fn(
      (nodeId: string, parentIdToUnlink: string | null, timestamp?: string) =>
        fakeDb.deleteNodeWithChildren(nodeId, parentIdToUnlink, timestamp)
    ),
    batchDeleteNodes: vi.fn((deletions: any[], timestamp?: string) =>
      fakeDb.batchDeleteNodes(deletions, timestamp)
    ),
    reorderSiblingsForAdd: vi.fn((treeId: string, parentId: string | null, order: number, timestamp?: string) =>
      fakeDb.reorderSiblingsForAdd(treeId, parentId, order, timestamp)
    ),
    batchCreateNodes: vi.fn((nodes: any[], timestamp?: string) =>
      fakeDb.batchCreateNodes(nodes, timestamp)
    ),
    batchUpdateNodes: vi.fn((updates: any[], timestamp?: string) =>
      fakeDb.batchUpdateNodes(updates, timestamp)
    ),
    addParentToNode: vi.fn((nodeId: string, newParentId: string | null, newOrder: number, timestamp?: string) =>
      fakeDb.addParentToNode(nodeId, newParentId, newOrder, timestamp)
    ),
    removeParentFromNode: vi.fn((nodeId: string, parentIdToRemove: string, timestamp?: string) =>
      fakeDb.removeParentFromNode(nodeId, parentIdToRemove, timestamp)
    ),
  };
});

beforeEach(() => {
  resetIdCounter();
  fakeDb.reset();
  fakeDb.sessionUserId = 'user-1';
});
