import { describe, it, expect } from 'vitest';
import { makeTree, describeTree, flatPlacements, defaultTemplate } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant, knownBug } from './harness';
import {
  updateNodeAction,
  batchUpdateNodesDataAction,
  updateNodeNamesForTemplateAction,
  toggleStarredForSelectedNodesAction,
} from '@/lib/node-actions';

describe('Update Actions', () => {
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
            data: { 'f-title': 'Old Title', 'f-desc': 'Desc' },
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
            data: { 'f-title': 'Old Title', 'f-desc': 'Desc' },
          },
        ],
      },
    ]);

  it('update single node: all instances of a clone are updated', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await updateNodeAction(ctx, 'C', { name: 'New Name for C' });
    });

    // Both instances of C in memory must have the updated name
    const instanceUnderA = memoryTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    const instanceUnderB = memoryTree.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!;
    expect(instanceUnderA.name).toBe('New Name for C');
    expect(instanceUnderB.name).toBe('New Name for C');

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(undoneTree.tree)).toEqual(flatPlacements(startTree.tree));
    const undoneUnderA = undoneTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    expect(undoneUnderA.name).toBe('Node C');

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(flatPlacements(redoneTree.tree)).toEqual(flatPlacements(memoryTree.tree));
  });

  it('batch data update: updates data on specified nodes', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await batchUpdateNodesDataAction(ctx, ['C_A'], { 'f-title': 'Updated Title C' });
    });

    const instanceUnderA = memoryTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    const instanceUnderB = memoryTree.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!;
    expect(instanceUnderA.data['f-title']).toBe('Updated Title C');
    expect(instanceUnderB.data['f-title']).toBe('Updated Title C');

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    const undoneC = undoneTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    expect(undoneC.data['f-title']).toBe('Old Title');

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    const redoneC = redoneTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    expect(redoneC.data['f-title']).toBe('Updated Title C');
  });

  it('template rename (updateNodeNamesForTemplate): renames matching nodes based on template formula', async () => {
    const template = {
      ...defaultTemplate(),
      nameTemplate: 'Template: {title}',
    };
    const startTree = makeTree(
      [
        {
          id: 'A',
          name: 'Old A',
          data: { 'f-title': 'Alpha' },
          children: [],
        },
        {
          id: 'B',
          name: 'Old B',
          data: { 'f-title': 'Bravo' },
          children: [],
        },
      ],
      'tree-1',
      'user-1',
      'Test Tree',
      [template]
    );

    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await updateNodeNamesForTemplateAction(ctx, template);
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.name).toBe('Template: Alpha');

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(undoneTree.tree.find((n) => n.id === 'A')!.name).toBe('Old A');

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(redoneTree.tree.find((n) => n.id === 'A')!.name).toBe('Template: Alpha');
  });

  knownBug(
    'KNOWN BUG: updateNodeNamesForTemplate on clones: updates names across all clone instances (findNodeAndParentInDraft only updates first instance)',
    /expected 'Old C' to be 'Item: CloneItem'/,
    async () => {
    const template = {
      ...defaultTemplate(),
      nameTemplate: 'Item: {title}',
    };

    // Tree with clone C under A and B, using template
    const startTree = makeTree(
      [
        {
          id: 'A',
          name: 'Parent A',
          children: [
            {
              id: 'C',
              name: 'Old C',
              parentIds: ['A', 'B'],
              order: [0, 0],
              data: { 'f-title': 'CloneItem' },
            },
          ],
        },
        {
          id: 'B',
          name: 'Parent B',
          children: [
            {
              id: 'C',
              name: 'Old C',
              parentIds: ['A', 'B'],
              order: [0, 0],
              data: { 'f-title': 'CloneItem' },
            },
          ],
        },
      ],
      'tree-1',
      'user-1',
      'Test Tree',
      [template]
    );

    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await updateNodeNamesForTemplateAction(ctx, template);
    });

    const instanceA = memoryTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    const instanceB = memoryTree.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!;
    expect(instanceA.name).toBe('Item: CloneItem');
    expect(instanceB.name).toBe('Item: CloneItem');

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    const undoneInstanceA = undoneTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    expect(undoneInstanceA.name).toBe('Old C');

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    const redoneInstanceA = redoneTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
    expect(redoneInstanceA.name).toBe('Item: CloneItem');
  });

  it('toggle starred on regular node: toggles isStarred', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(
      startTree,
      async (ctx) => {
        await toggleStarredForSelectedNodesAction(ctx);
      },
      { selectedNodeIds: ['A_root'] }
    );

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.isStarred).toBe(true);

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(undoneTree.tree.find((n) => n.id === 'A')!.isStarred).toBe(false);

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(redoneTree.tree.find((n) => n.id === 'A')!.isStarred).toBe(true);
  });

  knownBug(
    'KNOWN BUG: toggle starred on a clone: updates isStarred across all instances (currently findNodeAndParentInDraft only updates first instance)',
    /isStarred of the instance under B: expected false to be true/,
    async () => {
      const startTree = getStartingTree();
      const { memoryTree } = await fullCycle(
        startTree,
        async (ctx) => {
          await toggleStarredForSelectedNodesAction(ctx);
        },
        { selectedNodeIds: ['C_A'] }
      );

      const instanceUnderA = memoryTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
      const instanceUnderB = memoryTree.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!;
      expect(instanceUnderA.isStarred, 'isStarred of the instance under A').toBe(true);
      expect(instanceUnderB.isStarred, 'isStarred of the instance under B').toBe(true);

      assertConsistencyInvariant(memoryTree);
    }
  );
});
