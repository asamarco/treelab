import { describe, it, expect } from 'vitest';
import { makeTree, describeTree, flatPlacements, reachableIds, assertInstancesConsistent } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant, perform, knownBug } from './harness';
import { deleteNodesAction, deleteNodeAction } from '@/lib/node-actions';

describe('Delete Actions', () => {
  // Tree structure:
  // Root A (0) -> child C (clone, parentIds: ['A', 'B'])
  // Root B (1) -> child C (clone)
  // Root D (2) -> child E (sole child) -> child F
  const getStartingTree = () =>
    makeTree([
      {
        id: 'A',
        order: [0],
        children: [
          {
            id: 'C',
            parentIds: ['A', 'B'],
            order: [0, 0],
          },
        ],
      },
      {
        id: 'B',
        order: [1],
        children: [
          {
            id: 'C',
            parentIds: ['A', 'B'],
            order: [0, 0],
          },
        ],
      },
      {
        id: 'D',
        order: [2],
        children: [
          {
            id: 'E',
            order: [0],
            children: [
              {
                id: 'F',
                order: [0],
              },
            ],
          },
        ],
      },
    ]);

  it('delete single leaf: removes leaf node and updates siblings', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await deleteNodeAction(ctx, 'F', 'E');
    });

    const nodeD = memoryTree.tree.find((n) => n.id === 'D')!;
    const nodeE = nodeD.children.find((c) => c.id === 'E')!;
    expect(nodeE.children).toEqual([]);

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(startTree.tree));
    expect(fakeDb.dbPlacements()).toEqual(flatPlacements(startTree.tree));

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
    expect(fakeDb.dbPlacements()).toEqual(flatPlacements(memoryTree.tree));
  });

  it('delete multiple nodes: deletes multiple selected nodes', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await deleteNodesAction(ctx, ['D_root']);
    });

    expect(memoryTree.tree.map((n) => n.id)).toEqual(['A', 'B']);
    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(startTree.tree));

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
  });

  it('delete one instance of a clone: node survives under the other parent', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      // Unlink C from A
      await deleteNodeAction(ctx, 'C', 'A');
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.id)).toEqual([]);

    const nodeB = memoryTree.tree.find((n) => n.id === 'B')!;
    expect(nodeB.children.map((c) => c.id)).toEqual(['C']);

    const survivingC = nodeB.children.find((c) => c.id === 'C')!;
    expect(survivingC.parentIds).toEqual(['B']);

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(startTree.tree));

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
  });

  it('delete a whole subtree: removes parent and all descendants', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await deleteNodeAction(ctx, 'E', 'D');
    });

    const nodeD = memoryTree.tree.find((n) => n.id === 'D')!;
    expect(nodeD.children).toEqual([]);

    // E and F should not be reachable and should be removed from DB
    expect(reachableIds(memoryTree.tree).has('E')).toBe(false);
    expect(reachableIds(memoryTree.tree).has('F')).toBe(false);

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(startTree.tree));

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
  });

  /**
   * KNOWN BUG 1: delete a node whose child is also a clone under another parent:
   * The child must survive in memory too (the DB keeps it); invariant memory == db.
   *
   * Setup:
   * Root P1 -> child X -> child K (clone, parentIds: ['X', 'P2'])
   * Root P2 -> child K (clone)
   *
   * When X is deleted, K still has parent P2!
   * In DB: X is deleted, K is only unlinked from X so K survives under P2.
   * In Memory (current bug in deleteNodesAction execute lines 866-878):
   * deleteNodesAction removes X from allNodesMap and recursively removes all of X's descendants
   * (including K) from allNodesMap! So K disappears from P2 in memory even though K is still linked to P2 in DB!
   */
  knownBug(
    'KNOWN BUG: delete a node whose child is also a clone under another parent: the child must survive in memory too (the DB keeps it); invariant memory == db',
    /expected \[\].*to include 'K'/,
    async () => {
      const treeWithCloneChild = makeTree([
        {
          id: 'P1',
          order: [0],
          children: [
            {
              id: 'X',
              order: [0],
              children: [
                {
                  id: 'K',
                  parentIds: ['X', 'P2'],
                  order: [0, 0],
                },
              ],
            },
          ],
        },
        {
          id: 'P2',
          order: [1],
          children: [
            {
              id: 'K',
              parentIds: ['X', 'P2'],
              order: [0, 0],
            },
          ],
        },
      ]);

      const { memoryTree } = await fullCycle(treeWithCloneChild, async (ctx) => {
        await deleteNodeAction(ctx, 'X', 'P1');
      });

      // Expected correct behavior:
      // K must still be in P2 in memory!
      const p2 = memoryTree.tree.find((n) => n.id === 'P2');
      expect(p2?.children.map((c) => c.id)).toContain('K');

      // Memory and DB placements must match
      assertConsistencyInvariant(memoryTree);
    }
  );

  it('delete a single-parent leaf that is NOT a clone: parent has no remaining children', async () => {
    const startTree = makeTree([
      {
        id: 'Parent',
        order: [0],
        children: [
          {
            id: 'Leaf',
            order: [0],
          },
        ],
      },
    ]);

    const { memoryTree } = await fullCycle(startTree, async (ctx) => {
      await deleteNodeAction(ctx, 'Leaf', 'Parent');
    });

    const parent = memoryTree.tree.find((n) => n.id === 'Parent')!;
    expect(parent.children).toEqual([]);

    // Leaf must be gone from DB too
    assertConsistencyInvariant(memoryTree);
    expect(reachableIds(memoryTree.tree).has('Leaf')).toBe(false);
  });

  /**
   * KNOWN BUG: delete a node, undo, and assert the restored node keeps its ORIGINAL createdAt
   * (expected behavior; today the undo restores it with a new createdAt via batchCreateNodes).
   */
  knownBug(
    'KNOWN BUG: delete a node, undo: restored node must keep its original createdAt',
    /expected '.*' to be '2020-01-01T00:00:00\.000Z'/,
    async () => {
      const originalCreatedAt = '2020-01-01T00:00:00.000Z';
      const startTree = makeTree([
        {
          id: 'Parent',
          order: [0],
          children: [
            {
              id: 'Leaf',
              order: [0],
              createdAt: originalCreatedAt,
            },
          ],
        },
      ]);

      const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
        await deleteNodeAction(ctx, 'Leaf', 'Parent');
      });

      // Undo deletion
      const undoneTrees = await undoOn([memoryTree], command);
      const restoredInDb = fakeDb.records.get('Leaf');

      // The restored node in DB must retain its original createdAt
      expect(restoredInDb?.createdAt).toBe(originalCreatedAt);
    }
  );

  /**
   * KNOWN BUG 3b: undo of deleting 5 nodes makes at most 3 server calls
   * (one existence check, one create, one update); today it makes one per node.
   */
  knownBug(
    'KNOWN BUG: undo of deleting 5 nodes makes at most 3 server calls (observed 11)',
    /number of server calls on delete undo: expected 11 to be less than or equal to 3/,
    async () => {
      // 5 root nodes D1..D5
      const specs = Array.from({ length: 5 }, (_, i) => ({
        id: `D${i + 1}`,
        order: [i],
      }));
      const tree = makeTree(specs);

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await deleteNodesAction(ctx, ['D1_root', 'D2_root', 'D3_root', 'D4_root', 'D5_root']);
      });

      fakeDb.calls = [];
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;

      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      expect(fakeDb.dbPlacements()).toEqual(flatPlacements(tree.tree));

      for (let i = 1; i <= 5; i++) {
        const id = `D${i}`;
        const rec = fakeDb.records.get(id);
        expect(rec, `node ${id} exists in DB`).toBeDefined();
        expect(rec?.parentIds, `node ${id} parentIds`).toEqual(['root']);
        expect(rec?.order, `node ${id} order`).toEqual([i - 1]);
      }

      expect(fakeDb.calls.length, 'number of server calls on delete undo').toBeLessThanOrEqual(3);
    }
  );
});

