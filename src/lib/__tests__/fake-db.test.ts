/**
 * fake-db.test.ts
 *
 * Contract tests for FakeDatabase methods. Each test mirrors the behaviour of
 * the corresponding real data-service.ts function. The comment above each
 * test quotes the specific line(s) from data-service.ts that define the
 * behaviour under test.
 *
 * Only fake-DB methods are used here (no node-actions). Nodes are seeded
 * directly via fakeDb.seedFromNodes / fakeDb.records.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDatabase } from './fake-db';

// Helper: create a minimal valid node record for seeding.
function rec(
  overrides: Partial<{
    id: string;
    treeId: string;
    userId: string;
    name: string;
    templateId: string;
    parentIds: string[];
    order: number[];
    createdAt: string;
    updatedAt: string;
  }> = {}
) {
  return {
    id: 'node-1',
    treeId: 'tree-1',
    userId: 'user-1',
    name: 'Test Node',
    templateId: 't-default',
    data: {},
    isStarred: false,
    parentIds: ['root'],
    order: [0],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FakeDatabase contract tests', () => {
  let db: FakeDatabase;

  beforeEach(() => {
    db = new FakeDatabase();
    db.sessionUserId = 'user-1';
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 1: batchCreateNodes ignores input createdAt/updatedAt
  //
  // data-service.ts line 913-914:
  //   createdAt: newTimestamp,
  //   updatedAt: newTimestamp,
  // (always uses the computed timestamp, ignoring any field on the input)
  // ─────────────────────────────────────────────────────────────────────
  it('batchCreateNodes ignores input createdAt/updatedAt', async () => {
    const forcedTimestamp = '2026-01-01T00:00:00.000Z';
    const result = await db.batchCreateNodes(
      [
        {
          treeId: 'tree-1',
          name: 'Node A',
          templateId: 't-default',
          parentIds: ['root'],
          order: [0],
          // These should be ignored in favour of forcedTimestamp:
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        } as any,
      ],
      forcedTimestamp
    );

    expect(result.createdNodes).toHaveLength(1);
    const stored = db.records.get(result.createdNodes[0].id)!;
    expect(stored.createdAt).toBe(forcedTimestamp);
    expect(stored.updatedAt).toBe(forcedTimestamp);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: batchCreateNodes forces userId to the session user
  //
  // data-service.ts line 907:
  //   userId: session.userId,
  // ─────────────────────────────────────────────────────────────────────
  it('batchCreateNodes forces userId to the session user', async () => {
    db.sessionUserId = 'user-1';
    const result = await db.batchCreateNodes([
      {
        treeId: 'tree-1',
        name: 'Node A',
        templateId: 't-default',
        userId: 'someone-else' as any,
        parentIds: ['root'],
        order: [0],
      } as any,
    ]);

    expect(result.createdNodes).toHaveLength(1);
    const stored = db.records.get(result.createdNodes[0].id)!;
    expect(stored.userId).toBe('user-1');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: batchCreateNodes throws on mismatched treeId and missing templateId
  //
  // data-service.ts line 887-891:
  //   for (const n of nodes) {
  //     if (!n || n.treeId !== treeId) {
  //       throw new Error("Batch create nodes must all share the same authorized treeId.");
  //     }
  //   }
  // (no equivalent for templateId in real code, but the fake enforces it as a
  //  guard against test-fixture mistakes.)
  // ─────────────────────────────────────────────────────────────────────
  it('batchCreateNodes throws when nodes have different treeIds', async () => {
    await expect(
      db.batchCreateNodes([
        { treeId: 'tree-1', name: 'A', templateId: 't-default', parentIds: ['root'], order: [0] } as any,
        { treeId: 'tree-2', name: 'B', templateId: 't-default', parentIds: ['root'], order: [0] } as any,
      ])
    ).rejects.toThrow('Batch create nodes must all share the same authorized treeId.');
  });

  it('batchCreateNodes throws when a node has no templateId', async () => {
    await expect(
      db.batchCreateNodes([
        { treeId: 'tree-1', name: 'A', parentIds: ['root'], order: [0] } as any,
      ])
    ).rejects.toThrow('templateId is required');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 4: removeParentFromNode throws for invalid parentId; control: valid removal works
  //
  // data-service.ts line 1035-1036:
  //   assertId(nodeId, 'nodeId');
  //   assertId(parentIdToRemove, 'parentIdToRemove');
  // (assertId throws for null, undefined, and '')
  // ─────────────────────────────────────────────────────────────────────
  it('removeParentFromNode throws for null, undefined and empty string parentId; control removes valid parent', async () => {
    db.records.set('node-1', rec({ parentIds: ['P1', 'P2'], order: [0, 0] }));

    await expect(
      db.removeParentFromNode('node-1', null as any)
    ).rejects.toThrow();

    await expect(
      db.removeParentFromNode('node-1', undefined as any)
    ).rejects.toThrow();

    await expect(
      db.removeParentFromNode('node-1', '')
    ).rejects.toThrow();

    // Control: removing a valid parent succeeds
    await db.removeParentFromNode('node-1', 'P1');
    const stored = db.records.get('node-1')!;
    expect(stored.parentIds).toEqual(['P2']);
    expect(stored.order).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 5: addParentToNode dedupes
  //
  // data-service.ts line 1016-1030:
  //   if (!node.parentIds.includes(parentIdToAdd)) {
  //     node.parentIds.push(parentIdToAdd);
  //     node.order.push(newOrder);
  //   } else {
  //     const parentIndex = node.parentIds.indexOf(parentIdToAdd);
  //     if (parentIndex !== -1) { node.order[parentIndex] = newOrder; }
  //   }
  // ─────────────────────────────────────────────────────────────────────
  it('addParentToNode dedupes: re-adding an existing parent only updates order; adding new parent appends', async () => {
    db.records.set('node-1', rec({ parentIds: ['P1'], order: [5] }));

    // Re-add the same parent – should NOT grow parentIds, but update order
    await db.addParentToNode('node-1', 'P1', 99);
    let stored = db.records.get('node-1')!;
    expect(stored.parentIds).toEqual(['P1']);
    expect(stored.order).toEqual([99]);

    // Add a genuinely new parent – should append to both arrays
    await db.addParentToNode('node-1', 'P2', 3);
    stored = db.records.get('node-1')!;
    expect(stored.parentIds).toEqual(['P1', 'P2']);
    expect(stored.order).toEqual([99, 3]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 6: deleteNodeWithChildren – three cases
  //
  // data-service.ts line 764-775 (clone unlinking):
  //   if (node.parentIds.length > 1) {
  //     ...splice parentIds/order, save, resequence...
  //     return { deletedIds: [], newTimestamp };
  //   }
  //
  // data-service.ts line 783-800 (cascade):
  //   if (child.parentIds.length === 1 && child.parentIds[0] === id) {
  //     deletedIds.push(childId); await findChildrenAndUnlinkOrDelete(childId);
  //   } else { ...unlink only... }
  // ─────────────────────────────────────────────────────────────────────
  it('deleteNodeWithChildren case a: node with two parents is only unlinked from one', async () => {
    db.records.set('clone', rec({ id: 'clone', parentIds: ['P1', 'P2'], order: [0, 0] }));
    db.records.set('P1', rec({ id: 'P1', parentIds: ['root'], order: [0] }));
    db.records.set('P2', rec({ id: 'P2', parentIds: ['root'], order: [1] }));

    const { deletedIds } = await db.deleteNodeWithChildren('clone', 'P1');

    expect(deletedIds).toHaveLength(0); // node NOT permanently deleted
    const stored = db.records.get('clone')!;
    expect(stored).toBeDefined();
    expect(stored.parentIds).toEqual(['P2']); // only other parent remains
  });

  it('deleteNodeWithChildren case b: single-parent node deleted; sole-parent child deleted too', async () => {
    db.records.set('parent', rec({ id: 'parent', parentIds: ['root'], order: [0] }));
    db.records.set('child', rec({ id: 'child', parentIds: ['parent'], order: [0] }));

    const { deletedIds } = await db.deleteNodeWithChildren('parent', null);

    expect(deletedIds).toContain('parent');
    expect(deletedIds).toContain('child');
    expect(db.records.has('parent')).toBe(false);
    expect(db.records.has('child')).toBe(false);
  });

  it('deleteNodeWithChildren case c: single-parent node deleted; child with second parent survives unlinked', async () => {
    // parent → child; child also has P2 as a second parent
    db.records.set('parent', rec({ id: 'parent', parentIds: ['root'], order: [0] }));
    db.records.set('P2', rec({ id: 'P2', parentIds: ['root'], order: [1] }));
    db.records.set('child', rec({ id: 'child', parentIds: ['parent', 'P2'], order: [0, 0] }));

    const { deletedIds } = await db.deleteNodeWithChildren('parent', null);

    // parent is gone; child survives under P2
    expect(deletedIds).toContain('parent');
    expect(deletedIds).not.toContain('child');
    expect(db.records.has('parent')).toBe(false);
    const childStored = db.records.get('child')!;
    expect(childStored).toBeDefined();
    expect(childStored.parentIds).toEqual(['P2']); // unlinked from parent
    expect(childStored.order).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 7: Auth – every mutating function throws when sessionUserId is null
  //
  // Checked functions (each calls this.requireAuth() / real service checks
  // session?.userId):
  //   - batchCreateNodes   (line 893: authorizeTreeAccess → session required)
  //   - createNode         (line 625: authorizeTreeAccess → session required)
  //   - batchUpdateNodes   (line 942-943: getSession → "Authentication required.")
  //   - deleteNodeWithChildren (line 746-747: getSession → "Authentication required.")
  //   - addParentToNode    (line 999-1000: getSession → "Authentication required.")
  //   - removeParentFromNode (line 1038-1039: getSession → "Authentication required.")
  //   - reorderSiblingsForAdd (line 845: authorizeTreeAccess → session required)
  //   - updateNode         (line 664-665: getSession → "Authentication required.")
  //   - resequenceSiblings (line 703: authorizeTreeAccess → line 97-98: getSession → "Authentication required.")
  //   - findNodeById       (line 128-129: getSession → "Authentication required.")
  // ─────────────────────────────────────────────────────────────────────
  it('Auth: mutating functions throw "Authentication required." when sessionUserId is null', async () => {
    db.sessionUserId = null;

    // batchCreateNodes
    await expect(
      db.batchCreateNodes([{ treeId: 'tree-1', name: 'X', templateId: 't-default' } as any])
    ).rejects.toThrow('Authentication required.');

    // createNode
    await expect(
      db.createNode({ treeId: 'tree-1', name: 'X', templateId: 't-default' } as any)
    ).rejects.toThrow('Authentication required.');

    // batchUpdateNodes (seed a node first so it doesn't short-circuit on empty array)
    db.sessionUserId = 'user-1';
    db.records.set('n1', rec({ id: 'n1' }));
    db.sessionUserId = null;
    await expect(
      db.batchUpdateNodes([{ id: 'n1', updates: { name: 'Y' } }])
    ).rejects.toThrow('Authentication required.');

    // deleteNodeWithChildren
    db.sessionUserId = 'user-1';
    db.records.set('n2', rec({ id: 'n2' }));
    db.sessionUserId = null;
    await expect(
      db.deleteNodeWithChildren('n2', null)
    ).rejects.toThrow('Authentication required.');

    // addParentToNode
    db.sessionUserId = 'user-1';
    db.records.set('n3', rec({ id: 'n3' }));
    db.sessionUserId = null;
    await expect(
      db.addParentToNode('n3', 'P1', 0)
    ).rejects.toThrow('Authentication required.');

    // removeParentFromNode
    db.sessionUserId = 'user-1';
    db.records.set('n4', rec({ id: 'n4', parentIds: ['P1'], order: [0] }));
    db.sessionUserId = null;
    await expect(
      db.removeParentFromNode('n4', 'P1')
    ).rejects.toThrow('Authentication required.');

    // reorderSiblingsForAdd
    await expect(
      db.reorderSiblingsForAdd('tree-1', null, 0)
    ).rejects.toThrow('Authentication required.');

    // updateNode (data-service.ts lines 664-665: if (!session?.userId) throw new Error("Authentication required.");)
    db.sessionUserId = 'user-1';
    db.records.set('n5', rec({ id: 'n5' }));
    db.sessionUserId = null;
    await expect(
      db.updateNode('n5', { name: 'New Name' })
    ).rejects.toThrow('Authentication required.');

    // resequenceSiblings (data-service.ts line 703 -> authorizeTreeAccess line 97-98: if (!session?.userId) throw new Error("Authentication required.");)
    await expect(
      db.resequenceSiblings('root', 'tree-1')
    ).rejects.toThrow('Authentication required.');

    // findNodeById (data-service.ts lines 128-129: if (!session?.userId) throw new Error("Authentication required.");)
    await expect(
      db.findNodeById('n5')
    ).rejects.toThrow('Authentication required.');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 8: resequenceSiblings makes orders contiguous after deletion
  //
  // data-service.ts line 721-735:
  //   siblings.sort((a, b) => ...);
  //   const bulkOps = siblings.map((sibling, index) => {
  //     ...newOrder[parentIndex] = index; // Explicitly set to zero-based index
  //   });
  // ─────────────────────────────────────────────────────────────────────
  it('resequenceSiblings: after deleting one of three siblings, remaining two get orders 0 and 1 for that parent', async () => {
    // Three siblings under 'parent' with orders 0, 1, 2
    // Each also has a second parent 'other' with a fixed order that must not change
    db.records.set('s0', {
      ...rec({ id: 's0' }),
      parentIds: ['parent', 'other'],
      order: [0, 10],
    });
    db.records.set('s1', {
      ...rec({ id: 's1' }),
      parentIds: ['parent', 'other'],
      order: [1, 20],
    });
    db.records.set('s2', {
      ...rec({ id: 's2' }),
      parentIds: ['parent', 'other'],
      order: [2, 30],
    });

    // Delete s1 manually (simulating what deleteNodeWithChildren would do to the middle sibling)
    db.records.delete('s1');

    // Now resequence under 'parent'
    await db.resequenceSiblings('parent', 'tree-1');

    const s0 = db.records.get('s0')!;
    const s2 = db.records.get('s2')!;

    // Orders for 'parent' must be 0 and 1 (contiguous, zero-based)
    const orderForParent = (r: typeof s0) => r.order[r.parentIds.indexOf('parent')];
    const orderForOther = (r: typeof s0) => r.order[r.parentIds.indexOf('other')];

    expect(new Set([orderForParent(s0), orderForParent(s2)])).toEqual(new Set([0, 1]));

    // Orders for 'other' must be untouched
    expect(orderForOther(s0)).toBe(10);
    expect(orderForOther(s2)).toBe(30);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 12: recordCall runs before requireAuth, counting calls even when they throw
  // ─────────────────────────────────────────────────────────────────────
  it('recordCall runs before requireAuth: attempted call is recorded even when throwing Authentication required', async () => {
    db.sessionUserId = null;
    db.calls = [];

    await expect(db.updateNode('node-1', { name: 'New Name' })).rejects.toThrow('Authentication required.');

    expect(db.calls.length).toBe(1);
    expect(db.calls[0].method).toBe('updateNode');
    expect(db.calls[0].args[0]).toBe('node-1');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 13 & 14: Step 8d table-driven recordCall test and prototype guard
  // ─────────────────────────────────────────────────────────────────────
  const EXCLUDED_HELPERS = new Set([
    'constructor',
    'recordCall',
    '_track',
    'reset',
    'seedFromNodes',
    'requireAuth',
    'dbPlacements',
  ]);

  const methodInvocations: { name: string; invoke: (db: FakeDatabase) => Promise<any> }[] = [
    {
      name: 'findNodeById',
      invoke: (d) => d.findNodeById('node-1'),
    },
    {
      name: 'createNode',
      invoke: (d) => d.createNode({ treeId: 'tree-1', name: 'N', templateId: 't-1' } as any),
    },
    {
      name: 'updateNode',
      invoke: (d) => d.updateNode('node-1', { name: 'Updated' }),
    },
    {
      name: 'resequenceSiblings',
      invoke: (d) => d.resequenceSiblings('parent-1', 'tree-1'),
    },
    {
      name: 'deleteNodeWithChildren',
      invoke: (d) => d.deleteNodeWithChildren('node-1', 'parent-1'),
    },
    {
      name: 'batchDeleteNodes',
      invoke: (d) => d.batchDeleteNodes([{ nodeId: 'node-1', parentIdToUnlink: 'parent-1' }]),
    },
    {
      name: 'reorderSiblingsForAdd',
      invoke: (d) => d.reorderSiblingsForAdd('tree-1', 'parent-1', 0),
    },
    {
      name: 'batchCreateNodes',
      invoke: (d) => d.batchCreateNodes([{ treeId: 'tree-1', name: 'N', templateId: 't-1' }]),
    },
    {
      name: 'batchUpdateNodes',
      invoke: (d) => d.batchUpdateNodes([{ id: 'node-1', updates: { name: 'U' } }]),
    },
    {
      name: 'addParentToNode',
      invoke: (d) => d.addParentToNode('node-1', 'parent-2', 0),
    },
    {
      name: 'removeParentFromNode',
      invoke: (d) => d.removeParentFromNode('node-1', 'parent-1'),
    },
  ];

  it('guard test: every public data-service method on FakeDatabase.prototype is in the table', () => {
    const protoProps = Object.getOwnPropertyNames(FakeDatabase.prototype);
    const tableMethodNames = new Set(methodInvocations.map((m) => m.name));

    for (const prop of protoProps) {
      if (EXCLUDED_HELPERS.has(prop)) continue;
      if (typeof (FakeDatabase.prototype as any)[prop] === 'function') {
        expect(tableMethodNames.has(prop), `Method ${prop} on FakeDatabase.prototype is missing from test table`).toBe(true);
      }
    }
  });

  it('table-driven: every public method records its call even when throwing with sessionUserId null', async () => {
    db.sessionUserId = null;

    for (const { name, invoke } of methodInvocations) {
      db.calls = [];
      try {
        await invoke(db);
      } catch {
        // Expected to throw authentication error
      }

      expect(db.calls.length, `Expected at least one call recorded for ${name}`).toBeGreaterThanOrEqual(1);
      expect(db.calls[0].method, `Expected first call method to be ${name}`).toBe(name);
    }
  });

  it('concurrent calls via Promise.all from the top level records BOTH calls', async () => {
    db.sessionUserId = 'user-1';
    db.records.set('node-1', rec({ id: 'node-1' }));
    db.calls = [];

    await Promise.all([
      db.findNodeById('node-1'),
      db.updateNode('node-1', { name: 'Concurrent Update' }),
    ]);

    expect(db.calls.length).toBe(2);
    expect(db.calls.map((c) => c.method)).toEqual(['findNodeById', 'updateNode']);
  });

  it('nested public method calls record only the outer call (batchDeleteNodes -> deleteNodeWithChildren)', async () => {
    db.sessionUserId = 'user-1';
    db.records.set('node-1', rec({ id: 'node-1' }));
    db.calls = [];

    await db.batchDeleteNodes([{ nodeId: 'node-1', parentIdToUnlink: null }]);

    expect(db.calls.length).toBe(1);
    expect(db.calls[0].method).toBe('batchDeleteNodes');
  });
});
