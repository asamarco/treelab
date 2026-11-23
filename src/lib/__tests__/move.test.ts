import { describe, it, expect } from 'vitest';
import { makeTree, describeTree, flatPlacements, assertInstancesConsistent, reachableIds } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant, perform, knownBug } from './harness';
import { moveNodesAction, moveNodeOrderAction } from '@/lib/node-actions';

describe('Move Actions', () => {
  // Tree with clone C under A and B, plus Parent P
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
        id: 'P',
        order: [2],
        children: [
          {
            id: 'P1',
            order: [0],
          },
          {
            id: 'P2',
            order: [1],
          },
          {
            id: 'P3',
            order: [2],
          },
        ],
      },
    ]);

  it('move single node to another parent: moves cleanly and resequences both', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await moveNodesAction(ctx, [
        {
          nodeId: 'P1',
          targetNodeId: 'A',
          position: 'child',
          sourceContextualParentId: 'P',
          targetContextualParentId: 'A',
        },
      ]);
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.id)).toContain('P1');

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

  it('move single node to root: changes parent to root', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await moveNodesAction(ctx, [
        {
          nodeId: 'P1',
          targetNodeId: 'end',
          position: 'sibling',
          sourceContextualParentId: 'P',
          targetContextualParentId: 'root',
        },
      ]);
    });

    expect(memoryTree.tree.map((n) => n.id)).toContain('P1');
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

  it('move within siblings (moveNodeOrderAction up and down): changes sibling order', async () => {
    const startTree = getStartingTree();
    // Move P1 down -> P2 becomes first, P1 becomes second
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await moveNodeOrderAction(ctx, 'P1', 'down', 'P');
    });

    const nodeP = memoryTree.tree.find((n) => n.id === 'P')!;
    expect(nodeP.children.map((c) => c.id)).toEqual(['P2', 'P1', 'P3']);

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

  it('move within siblings (moveNodeOrderAction up and down) on a clone: moves clone in specific parent context', async () => {
    // Tree where parent P has children [P1, C, P3], with C being a clone (parentIds: ['P', 'B'])
    const treeWithCloneSibling = makeTree([
      {
        id: 'P',
        order: [0],
        children: [
          { id: 'P1', order: [0] },
          { id: 'C', parentIds: ['P', 'B'], order: [1, 0] },
          { id: 'P3', order: [2] },
        ],
      },
      {
        id: 'B',
        order: [1],
        children: [
          { id: 'C', parentIds: ['P', 'B'], order: [1, 0] },
        ],
      },
    ]);

    // Move C up under P -> [C, P1, P3]
    const { memoryTree: treeAfterUp, command: cmdUp } = await fullCycle(treeWithCloneSibling, async (ctx) => {
      await moveNodeOrderAction(ctx, 'C', 'up', 'P');
    });

    const pAfterUp = treeAfterUp.tree.find((n) => n.id === 'P')!;
    expect(pAfterUp.children.map((c) => c.id)).toEqual(['C', 'P1', 'P3']);
    // C under B must remain intact
    const bAfterUp = treeAfterUp.tree.find((n) => n.id === 'B')!;
    expect(bAfterUp.children.map((c) => c.id)).toEqual(['C']);
    assertConsistencyInvariant(treeAfterUp);

    // Now move C down under P -> [P1, C, P3]
    const { memoryTree: treeAfterDown, command: cmdDown } = await fullCycle(treeAfterUp, async (ctx) => {
      await moveNodeOrderAction(ctx, 'C', 'down', 'P');
    });

    const pAfterDown = treeAfterDown.tree.find((n) => n.id === 'P')!;
    expect(pAfterDown.children.map((c) => c.id)).toEqual(['P1', 'C', 'P3']);
    assertConsistencyInvariant(treeAfterDown);

    // Undo down
    const undoneTrees = await undoOn([treeAfterDown], cmdDown);
    const undoneTree = undoneTrees.find((t) => t.id === treeWithCloneSibling.id)!;
    expect(undoneTree.tree.find((n) => n.id === 'P')!.children.map((c) => c.id)).toEqual(['C', 'P1', 'P3']);
  });

  it('passing two-node move to another parent: moves two nodes into new parent cleanly', async () => {
    const startTree = getStartingTree();
    // Move P1 and P2 from P into A as children
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await moveNodesAction(ctx, [
        {
          nodeId: 'P1',
          targetNodeId: 'A',
          position: 'child',
          sourceContextualParentId: 'P',
          targetContextualParentId: 'A',
        },
        {
          nodeId: 'P2',
          targetNodeId: 'A',
          position: 'child',
          sourceContextualParentId: 'P',
          targetContextualParentId: 'A',
        },
      ]);
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.id)).toEqual(['C', 'P1', 'P2']);

    const nodeP = memoryTree.tree.find((n) => n.id === 'P')!;
    expect(nodeP.children.map((c) => c.id)).toEqual(['P3']);

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(startTree.tree));
    assertConsistencyInvariant(undoneTree);

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
  });

  it('drag-style moves to first, middle and last position', async () => {
    const startTree = getStartingTree();
    // Move P3 to 'start' of P
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await moveNodesAction(ctx, [
        {
          nodeId: 'P3',
          targetNodeId: 'start',
          position: 'sibling',
          sourceContextualParentId: 'P',
          targetContextualParentId: 'P',
        },
      ]);
    });

    const nodeP = memoryTree.tree.find((n) => n.id === 'P')!;
    expect(nodeP.children.map((c) => c.id)).toEqual(['P3', 'P1', 'P2']);

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

  describe('Multi-node move actions (matching real callers)', () => {
    it('3 nodes as siblings of a root node: moves into root after target in selection order', async () => {
      // tree-node-header handlePaste: for 'sibling', moves are reversed
      const tree = makeTree([
        { id: 'S1', order: [0] },
        { id: 'S2', order: [1] },
        { id: 'S3', order: [2] },
        { id: 'TargetRoot', order: [3] },
      ]);
      const moves = [
        { nodeId: 'S1', targetNodeId: 'TargetRoot', position: 'sibling' as const, sourceContextualParentId: null, targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'S2', targetNodeId: 'TargetRoot', position: 'sibling' as const, sourceContextualParentId: null, targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'S3', targetNodeId: 'TargetRoot', position: 'sibling' as const, sourceContextualParentId: null, targetContextualParentId: null, isCutOperation: true },
      ].reverse();

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, moves);
      });

      const rootOrder = memoryTree.tree.map((n) => n.id);
      expect(rootOrder).toEqual(['TargetRoot', 'S1', 'S2', 'S3']);
      assertConsistencyInvariant(memoryTree);

      // Undo
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      assertConsistencyInvariant(undoneTree);

      // Redo
      const redoneTrees = await redoOn([undoneTree], command);
      const redoneTree = redoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
      assertConsistencyInvariant(redoneTree);
    });

    it('3 nodes as siblings of a nested node: moves into parent after target in selection order', async () => {
      // tree-node-header handlePaste: for 'sibling', moves are reversed
      const tree = makeTree([
        { id: 'S1', order: [0] },
        { id: 'S2', order: [1] },
        { id: 'S3', order: [2] },
        {
          id: 'P',
          order: [3],
          children: [
            { id: 'TargetNested', order: [0] },
            { id: 'OtherNested', order: [1] },
          ],
        },
      ]);
      const moves = [
        { nodeId: 'S1', targetNodeId: 'TargetNested', position: 'sibling' as const, sourceContextualParentId: null, targetContextualParentId: 'P', isCutOperation: true },
        { nodeId: 'S2', targetNodeId: 'TargetNested', position: 'sibling' as const, sourceContextualParentId: null, targetContextualParentId: 'P', isCutOperation: true },
        { nodeId: 'S3', targetNodeId: 'TargetNested', position: 'sibling' as const, sourceContextualParentId: null, targetContextualParentId: 'P', isCutOperation: true },
      ].reverse();

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, moves);
      });

      const p = memoryTree.tree.find((n) => n.id === 'P')!;
      const siblingOrder = p.children.map((c) => c.id);
      expect(siblingOrder).toEqual(['TargetNested', 'S1', 'S2', 'S3', 'OtherNested']);
      assertConsistencyInvariant(memoryTree);

      // Undo
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      assertConsistencyInvariant(undoneTree);

      // Redo
      const redoneTrees = await redoOn([undoneTree], command);
      const redoneTree = redoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
      assertConsistencyInvariant(redoneTree);
    });

    it('3 nodes as children of a root node: moves under root in clipboard selection order', async () => {
      // tree-selection-bar: position 'child', in clipboard order
      const tree = makeTree([
        { id: 'S1', order: [0] },
        { id: 'S2', order: [1] },
        { id: 'S3', order: [2] },
        { id: 'TargetRoot', order: [3], children: [{ id: 'ExistingChild', order: [0] }] },
      ]);
      const moves = [
        { nodeId: 'S1', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: null, targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'S2', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: null, targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'S3', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: null, targetContextualParentId: null, isCutOperation: true },
      ];

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, moves);
      });

      const target = memoryTree.tree.find((n) => n.id === 'TargetRoot')!;
      const childOrder = target.children.map((c) => c.id);
      expect(childOrder).toEqual(['ExistingChild', 'S1', 'S2', 'S3']);
      assertConsistencyInvariant(memoryTree);

      // Undo
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      assertConsistencyInvariant(undoneTree);

      // Redo
      const redoneTrees = await redoOn([undoneTree], command);
      const redoneTree = redoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
      assertConsistencyInvariant(redoneTree);
    });

    it('3 nodes as children of a nested node: moves under nested target in clipboard selection order', async () => {
      // tree-selection-bar / tree-node-header handlePaste('child'): position 'child', in clipboard order
      const tree = makeTree([
        { id: 'S1', order: [0] },
        { id: 'S2', order: [1] },
        { id: 'S3', order: [2] },
        {
          id: 'P',
          order: [3],
          children: [
            { id: 'TargetNested', order: [0], children: [{ id: 'ExistingChild', order: [0] }] },
          ],
        },
      ]);
      const moves = [
        { nodeId: 'S1', targetNodeId: 'TargetNested', position: 'child' as const, sourceContextualParentId: null, targetContextualParentId: 'P', isCutOperation: true },
        { nodeId: 'S2', targetNodeId: 'TargetNested', position: 'child' as const, sourceContextualParentId: null, targetContextualParentId: 'P', isCutOperation: true },
        { nodeId: 'S3', targetNodeId: 'TargetNested', position: 'child' as const, sourceContextualParentId: null, targetContextualParentId: 'P', isCutOperation: true },
      ];

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, moves);
      });

      const p = memoryTree.tree.find((n) => n.id === 'P')!;
      const target = p.children.find((c) => c.id === 'TargetNested')!;
      const childOrder = target.children.map((c) => c.id);
      expect(childOrder).toEqual(['ExistingChild', 'S1', 'S2', 'S3']);
      assertConsistencyInvariant(memoryTree);

      // Undo
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      assertConsistencyInvariant(undoneTree);

      // Redo
      const redoneTrees = await redoOn([undoneTree], command);
      const redoneTree = redoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
      assertConsistencyInvariant(redoneTree);
    });

    it('3 nodes taken from two different parents: moves under target in clipboard selection order', async () => {
      const tree = makeTree([
        {
          id: 'Parent1',
          order: [0],
          children: [
            { id: 'S1', order: [0] },
            { id: 'S2', order: [1] },
          ],
        },
        {
          id: 'Parent2',
          order: [1],
          children: [
            { id: 'S3', order: [0] },
          ],
        },
        { id: 'TargetRoot', order: [2], children: [] },
      ]);
      const moves = [
        { nodeId: 'S1', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: 'Parent1', targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'S2', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: 'Parent1', targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'S3', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: 'Parent2', targetContextualParentId: null, isCutOperation: true },
      ];

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, moves);
      });

      const target = memoryTree.tree.find((n) => n.id === 'TargetRoot')!;
      const childOrder = target.children.map((c) => c.id);
      expect(childOrder).toEqual(['S1', 'S2', 'S3']);
      assertConsistencyInvariant(memoryTree);

      // Undo
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      assertConsistencyInvariant(undoneTree);

      // Redo
      const redoneTrees = await redoOn([undoneTree], command);
      const redoneTree = redoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
      assertConsistencyInvariant(redoneTree);
    });

    /**
     * KNOWN BUG: pasting a selection as a sibling of one of its own members should leave
     * the order unchanged (['S1', 'S2', 'S3']).
     * Cause: in moveNodesAction, when S1 is moved as sibling of S1, S1 is first spliced out of
     * the siblings array. Finding targetNodeId 'S1' then returns targetIndex -1, causing insertIndex
     * to default to newSiblings.length (the end of the array), so S1 is appended at the end
     * resulting in ['S2', 'S3', 'S1'].
     */
    knownBug(
      'KNOWN BUG: three siblings of the same parent moved as sibling of the first one: order should remain unchanged',
      /order after pasting next to a selected node: expected \[ 'S2', 'S3', 'S1' \] to deeply equal \[ 'S1', 'S2', 'S3' \]/,
      async () => {
        const tree = makeTree([
          {
            id: 'P',
            order: [0],
            children: [
              { id: 'S1', order: [0] },
              { id: 'S2', order: [1] },
              { id: 'S3', order: [2] },
            ],
          },
        ]);

        const moves = [
          { nodeId: 'S1', targetNodeId: 'S1', position: 'sibling' as const, sourceContextualParentId: 'P', targetContextualParentId: 'P', isCutOperation: true },
          { nodeId: 'S2', targetNodeId: 'S1', position: 'sibling' as const, sourceContextualParentId: 'P', targetContextualParentId: 'P', isCutOperation: true },
          { nodeId: 'S3', targetNodeId: 'S1', position: 'sibling' as const, sourceContextualParentId: 'P', targetContextualParentId: 'P', isCutOperation: true },
        ].reverse();

        const { memoryTree } = await fullCycle(tree, async (ctx) => {
          await moveNodesAction(ctx, moves);
        });

        const p = memoryTree.tree.find((n) => n.id === 'P')!;
        expect(p.children.map((c) => c.id), 'order after pasting next to a selected node').toEqual(['S1', 'S2', 'S3']);
      }
    );

    it('selection of two nodes where one is a clone instance moved as child of another root', async () => {
      // Tree: P1 -> [Regular, Clone], P2 -> [Clone], TargetRoot -> []
      // Cut Regular and Clone (from P1), paste as child of TargetRoot
      // Clone under P2 should survive intact
      const tree = makeTree([
        {
          id: 'P1',
          order: [0],
          children: [
            { id: 'Regular', order: [0] },
            { id: 'Clone', parentIds: ['P1', 'P2'], order: [1, 0] },
          ],
        },
        {
          id: 'P2',
          order: [1],
          children: [
            { id: 'Clone', parentIds: ['P1', 'P2'], order: [1, 0] },
          ],
        },
        {
          id: 'TargetRoot',
          order: [2],
          children: [],
        },
      ]);

      const moves = [
        { nodeId: 'Regular', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: 'P1', targetContextualParentId: null, isCutOperation: true },
        { nodeId: 'Clone', targetNodeId: 'TargetRoot', position: 'child' as const, sourceContextualParentId: 'P1', targetContextualParentId: null, isCutOperation: true },
      ];

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, moves);
      });

      const target = memoryTree.tree.find((n) => n.id === 'TargetRoot')!;
      expect(target.children.map((c) => c.id)).toEqual(['Regular', 'Clone']);

      // Clone still exists under P2
      const p2 = memoryTree.tree.find((n) => n.id === 'P2')!;
      expect(p2.children.map((c) => c.id)).toEqual(['Clone']);

      assertConsistencyInvariant(memoryTree);

      // Undo
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      assertConsistencyInvariant(undoneTree);

      // Redo
      const redoneTrees = await redoOn([undoneTree], command);
      const redoneTree = redoneTrees.find((t) => t.id === tree.id)!;
      expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
      assertConsistencyInvariant(redoneTree);
    });
  });



  /**
   * KNOWN BUG 8: cut/move a node into its own descendant:
   * no node may disappear (reachableIds must still cover every node).
   * Note: The previous duplicate test ("cutting node A and pasting as child of B must be refused...")
   * was removed because isCutOperation is not read by moveNodesAction, and child moves ignore
   * targetContextualParentId, making it identical to this test.
   */
  knownBug(
    'KNOWN BUG: cut/move a node into its own descendant: no node may disappear (reachableIds must still cover every node)',
    /Maximum call stack size exceeded/,
    async () => {
      // Structure: Root Parent -> child Child
      // Moving Parent into Child creates a cycle where Parent is unlinked from Root
      // and attached to Child, making both unreachable from root!
      const tree = makeTree([
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

      const { memoryTree } = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, [
          {
            nodeId: 'Parent',
            targetNodeId: 'Child',
            position: 'child',
            sourceContextualParentId: null,
            targetContextualParentId: 'Child',
          },
        ]);
      });

      // No node may disappear - all nodes must still be reachable
      const reachable = reachableIds(memoryTree.tree);
      expect(reachable.has('Parent')).toBe(true);
      expect(reachable.has('Child')).toBe(true);
    }
  );

  it('moving a node into its own descendant leaves no half-applied state', async () => {
    const tree = makeTree([
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
    fakeDb.seedFromNodes(tree.tree, tree.id, tree.userId);

    const beforeTreeSnapshot = JSON.parse(JSON.stringify(tree.tree));
    const beforeDescribe = describeTree(beforeTreeSnapshot);
    const beforeFlat = flatPlacements(beforeTreeSnapshot);
    const beforeDbPlacements = fakeDb.dbPlacements();

    let memoryTree = tree;
    try {
      const res = await fullCycle(tree, async (ctx) => {
        await moveNodesAction(ctx, [
          {
            nodeId: 'Parent',
            targetNodeId: 'Child',
            position: 'child',
            sourceContextualParentId: null,
            targetContextualParentId: 'Child',
          },
        ]);
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

  it('positive control: valid move on the same tree changes flatPlacements and dbPlacements', async () => {
    const tree = makeTree([
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
    fakeDb.seedFromNodes(tree.tree, tree.id, tree.userId);

    const beforeTreeSnapshot = JSON.parse(JSON.stringify(tree.tree));
    const beforeDescribe = describeTree(beforeTreeSnapshot);
    const beforeFlat = flatPlacements(beforeTreeSnapshot);
    const beforeDbPlacements = fakeDb.dbPlacements();

    // Valid move: move Child to root
    const { memoryTree } = await fullCycle(tree, async (ctx) => {
      await moveNodesAction(ctx, [
        {
          nodeId: 'Child',
          targetNodeId: 'start',
          position: 'sibling',
          sourceContextualParentId: 'Parent',
          targetContextualParentId: null,
        },
      ]);
    });

    expect(describeTree(memoryTree.tree)).not.toEqual(beforeDescribe);
    expect(flatPlacements(memoryTree.tree)).not.toEqual(beforeFlat);
    expect(fakeDb.dbPlacements()).not.toEqual(beforeDbPlacements);
  });

  /**
   * KNOWN BUG: undo of a Move Down on a 12-node tree with 2 sibling nodes swapped writes
   * at most the changed nodes (expect 2 entries in batchUpdateNodes); today it writes every node (12).
   */
  knownBug(
    'KNOWN BUG: undo of a Move Down writes at most the changed nodes in batchUpdateNodes (expect 2 entries, observed 12)',
    /number of updated nodes on undo: expected 12 to be less than or equal to 2/,
    async () => {
      // 12 root sibling nodes: N01 .. N12
      const specs = Array.from({ length: 12 }, (_, i) => ({
        id: `N${String(i + 1).padStart(2, '0')}`,
        order: [i],
      }));
      const tree = makeTree(specs);

      const { memoryTree, command } = await fullCycle(tree, async (ctx) => {
        await moveNodeOrderAction(ctx, 'N01', 'down', null);
      });

      fakeDb.calls = [];
      const undoneTrees = await undoOn([memoryTree], command);
      const undoneTree = undoneTrees.find((t) => t.id === tree.id)!;

      expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(tree.tree));
      expect(fakeDb.dbPlacements()).toEqual(flatPlacements(tree.tree));

      const batchUpdateCall = fakeDb.calls.find((c) => c.method === 'batchUpdateNodes');
      const updatedEntries = batchUpdateCall ? batchUpdateCall.args[0] : [];

      expect(updatedEntries.length, 'number of updated nodes on undo').toBeLessThanOrEqual(2);
    }
  );
});


