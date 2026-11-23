import { describe, it, expect } from 'vitest';
import { makeTree, describeTree, flatPlacements, assertInstancesConsistent, reachableIds } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant, knownBug } from './harness';
import { pasteNodesAsClonesAction } from '@/lib/node-actions';

describe('Paste as Clone Actions', () => {
  // Tree with root A and root B
  const getStartingTree = () =>
    makeTree([
      {
        id: 'A',
        order: [0],
        children: [
          {
            id: 'A1',
            order: [0],
          },
        ],
      },
      {
        id: 'B',
        order: [1],
        children: [],
      },
    ]);

  it('paste-as-clone as child: adds node as clone under target', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await pasteNodesAsClonesAction(ctx, 'B', 'child', ['A1'], null);
    });

    const nodeB = memoryTree.tree.find((n) => n.id === 'B')!;
    expect(nodeB.children.map((c) => c.id)).toContain('A1');

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

  it('paste-as-clone as sibling: adds node as clone next to target', async () => {
    // Tree: A -> A1. Target: A1, as: 'sibling', contextualParentId: 'A'
    const startTree = makeTree([
      {
        id: 'A',
        order: [0],
        children: [
          {
            id: 'A1',
            order: [0],
          },
        ],
      },
      {
        id: 'B',
        order: [1],
        children: [
          {
            id: 'B1',
            order: [0],
          },
        ],
      },
    ]);

    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await pasteNodesAsClonesAction(ctx, 'A1', 'sibling', ['B1'], 'A');
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.id)).toEqual(['A1', 'B1']);
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

  it('root-level paste-as-clone execute baseline: adds node as clone at root level successfully', async () => {
    const startTree = getStartingTree();
    // Paste A1 as sibling of B (at root level)
    const { memoryTree } = await fullCycle(startTree, async (ctx) => {
      await pasteNodesAsClonesAction(ctx, 'B', 'sibling', ['A1'], null);
    });

    // In memory: A1 is at root level AND under A
    expect(memoryTree.tree.map((n) => n.id)).toContain('A1');
    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.id)).toContain('A1');

    // DB and memory must agree on placement
    assertConsistencyInvariant(memoryTree);
    assertInstancesConsistent(memoryTree.tree);
  });

  /**
   * KNOWN BUG 2: paste-as-clone under the parent that already contains the node, then undo:
   * the original keeps its link to that parent in both memory and db.
   *
   * When pasting A1 as child of A (where A is already A1's parent):
   * During undo (pasteNodesAsClonesAction getUndoState / undo):
   * removeParentFromNode removes the parent link entirely!
   */
  knownBug(
    'KNOWN BUG: paste-as-clone under the parent that already contains the node, then undo: the original keeps its link to that parent in both memory and db',
    /db parentIds: expected \[\s*\] to deeply equal \[ 'A' \]/,
    async () => {
      const startTree = getStartingTree();
      const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
        // Paste A1 under A again
        await pasteNodesAsClonesAction(ctx, 'A', 'child', ['A1'], null);
      });

      // Undo the action
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;

      // In correct behavior, A1 must still have A as its parent in both memory and db!
      const a1Node = undoneTree.tree.find((n) => n.id === 'A')?.children.find((c) => c.id === 'A1');
      const memoryParentIds = a1Node?.parentIds || [];
      const dbParentIds = fakeDb.records.get('A1')?.parentIds || [];

      expect(memoryParentIds, 'memory parentIds').toEqual(['A']);
      expect(dbParentIds, 'db parentIds').toEqual(['A']);

      assertConsistencyInvariant(undoneTree);
    }
  );

  /**
   * KNOWN BUG 3: paste-as-clone at root level, then undo: must not throw
   * (currently the null parent reaches removeParentFromNode and fails validation)
   */
  knownBug(
    'KNOWN BUG: paste-as-clone at root level, then undo: must not throw (null parent reaches removeParentFromNode and fails validation)',
    /Invalid parentIdToRemove/,
    async () => {
      const startTree = getStartingTree();
      // Paste A1 as sibling of B (at root level)
      const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
        await pasteNodesAsClonesAction(ctx, 'B', 'sibling', ['A1'], null);
      });

      // On undo, command.undo calls removeParentFromNode(u.nodeId, u.newParentId!)
      // When newParentId is null, removeParentFromNode throws: "Invalid parentIdToRemove."
      await undoOn([memoryTree], command);
    }
  );

  /**
   * KNOWN BUG 8 (paste-as-clone version): paste-as-clone into its own descendant:
   * no node may disappear (reachableIds must still cover every node).
   */
  knownBug(
    'KNOWN BUG: paste-as-clone into its own descendant: no node may disappear (reachableIds must still cover every node)',
    /Maximum call stack size exceeded/,
    async () => {
      const startTree = makeTree([
        {
          id: 'Parent',
          order: [0],
          children: [
            {
              id: 'Child',
              order: [0],
            },
          ],
        },
      ]);

      // Paste Parent as clone into Child
      const { memoryTree } = await fullCycle(startTree, async (ctx) => {
        await pasteNodesAsClonesAction(ctx, 'Child', 'child', ['Parent'], 'Parent');
      });

      const reachable = reachableIds(memoryTree.tree);
      expect(reachable.has('Parent')).toBe(true);
      expect(reachable.has('Child')).toBe(true);
    }
  );

  it('pasting a node as clone into its own descendant leaves no half-applied state', async () => {
    const startTree = makeTree([
      {
        id: 'Parent',
        order: [0],
        children: [
          {
            id: 'Child',
            order: [0],
          },
        ],
      },
    ]);

    fakeDb.reset();
    fakeDb.seedFromNodes(startTree.tree, startTree.id, startTree.userId);

    const beforeTreeSnapshot = JSON.parse(JSON.stringify(startTree.tree));
    const beforeDescribe = describeTree(beforeTreeSnapshot);
    const beforeFlat = flatPlacements(beforeTreeSnapshot);
    const beforeDbPlacements = fakeDb.dbPlacements();

    let memoryTree = startTree;
    try {
      const res = await fullCycle(startTree, async (ctx) => {
        await pasteNodesAsClonesAction(ctx, 'Child', 'child', ['Parent'], 'Parent');
      });
      memoryTree = res.memoryTree;
    } catch (e: any) {
      if (e instanceof TypeError || e instanceof ReferenceError) {
        throw e;
      }
      // Swallow other errors (e.g. RangeError today, or graceful refusal later)
    }

    expect(describeTree(memoryTree.tree), 'in-memory tree unchanged').toEqual(beforeDescribe);
    expect(flatPlacements(memoryTree.tree), 'in-memory tree unchanged').toEqual(beforeFlat);
    expect(fakeDb.dbPlacements(), 'fake db unchanged').toEqual(beforeDbPlacements);
    const reachable = reachableIds(memoryTree.tree);
    expect(reachable.has('Parent'), 'all nodes still reachable').toBe(true);
    expect(reachable.has('Child'), 'all nodes still reachable').toBe(true);
  });

  it('positive control: valid paste-as-clone on the same tree changes flatPlacements and dbPlacements', async () => {
    const startTree = makeTree([
      {
        id: 'Parent',
        order: [0],
        children: [
          {
            id: 'Child',
            order: [0],
          },
        ],
      },
    ]);

    fakeDb.reset();
    fakeDb.seedFromNodes(startTree.tree, startTree.id, startTree.userId);

    const beforeTreeSnapshot = JSON.parse(JSON.stringify(startTree.tree));
    const beforeDescribe = describeTree(beforeTreeSnapshot);
    const beforeFlat = flatPlacements(beforeTreeSnapshot);
    const beforeDbPlacements = fakeDb.dbPlacements();

    // Valid clone: paste Child as sibling at root level
    const { memoryTree } = await fullCycle(startTree, async (ctx) => {
      await pasteNodesAsClonesAction(ctx, 'Parent', 'sibling', ['Child'], null);
    });

    expect(describeTree(memoryTree.tree)).not.toEqual(beforeDescribe);
    expect(flatPlacements(memoryTree.tree)).not.toEqual(beforeFlat);
    expect(fakeDb.dbPlacements()).not.toEqual(beforeDbPlacements);
  });


  /**
   * KNOWN BUG 6b: paste-as-clone under the parent that already contains the node (execute + post, NO undo):
   * memory parentIds should equal db parentIds for A1.
   *
   * Observed values:
   * memory parentIds after paste: ['A', 'A']
   * db parentIds after paste: ['A']
   */
  knownBug(
    'KNOWN BUG: paste clone under own parent without undo: memory parentIds equals db parentIds',
    /memory parentIds after paste: expected \[ 'A', 'A' \] to deeply equal \[ 'A' \]/,
    async () => {
      const startTree = getStartingTree();
      const { memoryTree } = await fullCycle(startTree, async (ctx) => {
        await pasteNodesAsClonesAction(ctx, 'A', 'child', ['A1'], null);
      });

      const a1InMemory = memoryTree.tree.find((n) => n.id === 'A')?.children.find((c) => c.id === 'A1');
      const a1InDb = fakeDb.records.get('A1');

      expect(a1InMemory?.parentIds, 'memory parentIds after paste').toEqual(a1InDb?.parentIds);
    }
  );
});

