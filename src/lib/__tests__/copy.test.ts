import { describe, it, expect } from 'vitest';
import { makeTree, describeTree, flatPlacements, assertInstancesConsistent } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant } from './harness';
import { copyNodesAction } from '@/lib/node-actions';

describe('Copy then Paste Actions', () => {
  // Tree with clone C under A and B
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
        id: 'Target',
        order: [2],
        children: [],
      },
    ]);

  it('copy then paste as child: pastes copy under target node', async () => {
    const startTree = getStartingTree();
    const nodeA = startTree.tree.find((n) => n.id === 'A')!;

    const { memoryTree, command } = await fullCycle(
      startTree,
      async (ctx) => {
        await copyNodesAction(ctx, 'Target', 'child', null, [nodeA]);
      },
      {
        clipboard: { nodes: [nodeA], operation: 'copy' },
      }
    );

    const targetNode = memoryTree.tree.find((n) => n.id === 'Target')!;
    expect(targetNode.children.length).toBe(1);
    expect(targetNode.children[0].id).toBe('id-1'); // copy of A
    expect(targetNode.children[0].children[0].id).toBe('id-2'); // copy of C

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

  it('copy then paste as sibling: pastes copy after target node', async () => {
    const startTree = getStartingTree();
    const nodeA = startTree.tree.find((n) => n.id === 'A')!;

    const { memoryTree, command } = await fullCycle(
      startTree,
      async (ctx) => {
        await copyNodesAction(ctx, 'Target', 'sibling', null, [nodeA]);
      },
      {
        clipboard: { nodes: [nodeA], operation: 'copy' },
      }
    );

    const rootIds = memoryTree.tree.map((n) => n.id);
    expect(rootIds).toEqual(['A', 'B', 'Target', 'id-1']);

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

  it('copy then paste selection containing a clone: clone relations preserved across copies', async () => {
    // Both parents A and B are copied, with shared child C.
    // The pasted copies of A and B should both share the pasted copy of C!
    const startTree = getStartingTree();
    const nodeA = startTree.tree.find((n) => n.id === 'A')!;
    const nodeB = startTree.tree.find((n) => n.id === 'B')!;

    const { memoryTree, command } = await fullCycle(
      startTree,
      async (ctx) => {
        await copyNodesAction(ctx, 'Target', 'child', null, [nodeA, nodeB]);
      },
      {
        clipboard: { nodes: [nodeA, nodeB], operation: 'copy' },
      }
    );

    const target = memoryTree.tree.find((n) => n.id === 'Target')!;
    expect(target.children.length).toBe(2);
    const copyA = target.children[0];
    const copyB = target.children[1];

    // C was cloned under both A and B, so copy of C should be under both copyA and copyB with same ID
    expect(copyA.children[0].id).toBe(copyB.children[0].id);

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

  it('copy then paste with same node selected twice: duplicates are handled gracefully', async () => {
    const startTree = getStartingTree();
    const nodeA = startTree.tree.find((n) => n.id === 'A')!;

    const { memoryTree, command } = await fullCycle(
      startTree,
      async (ctx) => {
        await copyNodesAction(ctx, 'Target', 'child', null, [nodeA, nodeA]);
      },
      {
        clipboard: { nodes: [nodeA, nodeA], operation: 'copy' },
      }
    );

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
});
