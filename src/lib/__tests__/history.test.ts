import { describe, it, expect } from 'vitest';
import { makeTree, describeTree, flatPlacements, assertInstancesConsistent } from './fixtures';
import { fakeDb } from './fake-db';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant, perform } from './harness';
import {
  addRootNodeAction,
  addChildNodeAction,
  deleteNodeAction,
  moveNodesAction,
} from '@/lib/node-actions';
import { TreeFile, Command } from '@/lib/types';

describe('History (Undo / Redo Chains)', () => {
  it('chains of 3+ commands undone and redone fully with consistency invariant at every step', async () => {
    let currentTree = makeTree([
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

    const initialPlacements = flatPlacements(currentTree.tree);
    fakeDb.reset();
    fakeDb.seedFromNodes(currentTree.tree, currentTree.id, currentTree.userId);

    const commandHistory: Command[] = [];
    const treeSnapshots: TreeFile[] = [JSON.parse(JSON.stringify(currentTree))];

    // Step 1: Add a root node 'RootX'
    {
      const { command } = await perform(currentTree, async (ctx) => {
        await addRootNodeAction(ctx, { name: 'RootX', templateId: 't-default' });
      });
      currentTree = executeOn([currentTree], command)[0];
      if (command.post) await command.post(currentTree);
      commandHistory.push(command);
      treeSnapshots.push(JSON.parse(JSON.stringify(currentTree)));
      assertConsistencyInvariant(currentTree);
    }

    // Step 2: Move 'RootX' as a child under 'A'
    {
      const { command } = await perform(currentTree, async (ctx) => {
        await moveNodesAction(ctx, [
          {
            nodeId: 'id-1', // RootX
            targetNodeId: 'A',
            position: 'child',
            sourceContextualParentId: null,
            targetContextualParentId: 'A',
          },
        ]);
      });
      currentTree = executeOn([currentTree], command)[0];
      if (command.post) await command.post(currentTree);
      commandHistory.push(command);
      treeSnapshots.push(JSON.parse(JSON.stringify(currentTree)));
      assertConsistencyInvariant(currentTree);
    }

    // Step 3: Delete clone 'C' under 'A'
    {
      const { command } = await perform(currentTree, async (ctx) => {
        await deleteNodeAction(ctx, 'C', 'A');
      });
      currentTree = executeOn([currentTree], command)[0];
      if (command.post) await command.post(currentTree);
      commandHistory.push(command);
      treeSnapshots.push(JSON.parse(JSON.stringify(currentTree)));
      assertConsistencyInvariant(currentTree);
    }

    expect(commandHistory.length).toBe(3);

    // --- UNDO ALL 3 COMMANDS ---
    for (let i = commandHistory.length - 1; i >= 0; i--) {
      const cmd = commandHistory[i];
      currentTree = (await undoOn([currentTree], cmd))[0];
      assertConsistencyInvariant(currentTree);
      expect(flatPlacements(currentTree.tree)).toEqual(flatPlacements(treeSnapshots[i].tree));
    }

    // After full undo, must match initial state
    expect(flatPlacements(currentTree.tree)).toEqual(initialPlacements);
    expect(fakeDb.dbPlacements()).toEqual(initialPlacements);

    // --- REDO ALL 3 COMMANDS ---
    for (let i = 0; i < commandHistory.length; i++) {
      const cmd = commandHistory[i];
      currentTree = (await redoOn([currentTree], cmd))[0];
      assertConsistencyInvariant(currentTree);
      expect(flatPlacements(currentTree.tree)).toEqual(flatPlacements(treeSnapshots[i + 1].tree));
    }
  });
});
