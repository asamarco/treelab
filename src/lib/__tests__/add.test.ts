import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTree, describeTree, flatPlacements, defaultTemplate } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant } from './harness';
import {
  addRootNodeAction,
  addChildNodeAction,
  addSiblingNodeAction,
} from '@/lib/node-actions';

describe('Add Actions', () => {
  // Fixture with a clone: root nodes A and B, where C is a child under both A and B
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
    ]);

  it('add root node: adds at the end of root level', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await addRootNodeAction(ctx, { name: 'Root D', templateId: 't-default' });
    });

    // Check memory structure
    const described = describeTree(memoryTree.tree);
    expect(described.map((n) => n.id)).toEqual(['A', 'B', 'id-1']);

    // Invariant
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

  it('add child node: adds as child under specified parent', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await addChildNodeAction(ctx, 'A', { name: 'Child D', templateId: 't-default' }, 'A');
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.id)).toEqual(['C', 'id-1']);

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

  it('add sibling node with siblings that must shift: shifts subsequent siblings', async () => {
    // A (0), B (1). Add sibling to A -> new node gets order 1, B shifts to order 2.
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await addSiblingNodeAction(ctx, 'A', { name: 'Sibling S', templateId: 't-default' }, null);
    });

    const described = describeTree(memoryTree.tree);
    expect(described.map((n) => n.id)).toEqual(['A', 'id-1', 'B']);

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
});
