import { describe, it, expect, vi } from 'vitest';
import { makeTree, describeTree, flatPlacements, assertInstancesConsistent, defaultTemplate } from './fixtures';
import { fakeDb } from './fake-db';
import { makeCtx } from './ctx';
import { fullCycle, executeOn, undoOn, redoOn, assertConsistencyInvariant, knownBug } from './harness';
import {
  changeNodeTemplateAction,
  changeMultipleNodesTemplateAction,
  moveNodesAction,
} from '@/lib/node-actions';
import { Template } from '@/lib/types';

describe('Change Template Actions', () => {
  const template1: Template = {
    id: 't-1',
    name: 'Template 1',
    fields: [
      { id: 'f-common', name: 'common', type: 'text' },
      { id: 'f-extra1', name: 'extra1', type: 'text' },
    ],
    conditionalRules: [],
  };

  const template2: Template = {
    id: 't-2',
    name: 'Template 2',
    fields: [
      { id: 'f-common2', name: 'common', type: 'text' }, // same-named field 'common'
      { id: 'f-extra2', name: 'extra2', type: 'text' },
    ],
    conditionalRules: [],
  };

  // Tree with clone C under A and B, where C has descendant D
  const getStartingTree = () =>
    makeTree(
      [
        {
          id: 'A',
          templateId: 't-1',
          data: { 'f-common': 'Val A', 'f-extra1': 'Extra A' },
          children: [
            {
              id: 'C',
              templateId: 't-1',
              parentIds: ['A', 'B'],
              order: [0, 0],
              data: { 'f-common': 'Val C', 'f-extra1': 'Extra C' },
              children: [
                {
                  id: 'D',
                  templateId: 't-1',
                  parentIds: ['C'],
                  order: [0],
                  data: { 'f-common': 'Val D', 'f-extra1': 'Extra D' },
                },
              ],
            },
          ],
        },
        {
          id: 'B',
          templateId: 't-1',
          data: { 'f-common': 'Val B' },
          children: [
            {
              id: 'C',
              templateId: 't-1',
              parentIds: ['A', 'B'],
              order: [0, 0],
              data: { 'f-common': 'Val C', 'f-extra1': 'Extra C' },
              children: [
                {
                  id: 'D',
                  templateId: 't-1',
                  parentIds: ['C'],
                  order: [0],
                  data: { 'f-common': 'Val D', 'f-extra1': 'Extra D' },
                },
              ],
            },
          ],
        },
      ],
      'tree-1',
      'user-1',
      'Test Tree',
      [template1, template2]
    );

  it('change template of single node: updates templateId and transfers same-named fields', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await changeNodeTemplateAction(ctx, 'A', 't-2');
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    expect(nodeA.templateId).toBe('t-2');
    expect(nodeA.data['f-common2']).toBe('Val A');

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(undoneTree.tree.find((n) => n.id === 'A')!.templateId).toBe('t-1');

    // Redo
    const redoneTrees = await redoOn([undoneTree], command);
    const redoneTree = redoneTrees.find((t) => t.id === startTree.id)!;
    expect(redoneTree.tree.find((n) => n.id === 'A')!.templateId).toBe('t-2');
  });

  it('template change on several non-clone nodes: updates templateId and data on all selected nodes', async () => {
    const startTree = getStartingTree();
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await changeMultipleNodesTemplateAction(ctx, ['A_root', 'B_root'], 't-2');
    });

    const nodeA = memoryTree.tree.find((n) => n.id === 'A')!;
    const nodeB = memoryTree.tree.find((n) => n.id === 'B')!;
    expect(nodeA.templateId).toBe('t-2');
    expect(nodeA.data['f-common2']).toBe('Val A');
    expect(nodeB.templateId).toBe('t-2');
    expect(nodeB.data['f-common2']).toBe('Val B');

    assertConsistencyInvariant(memoryTree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    expect(undoneTree.tree.find((n) => n.id === 'A')!.templateId).toBe('t-1');
    expect(undoneTree.tree.find((n) => n.id === 'B')!.templateId).toBe('t-1');
  });

  knownBug(
    'KNOWN BUG: template change on a descendant of a clone: asserts name and data preserved across all clone branches (findNodeAndParentInDraft only updates first instance)',
    /templateId of the instance under B: expected 't-1' to be 't-2'/,
    async () => {
    const startTree = getStartingTree();
    // D is a child of clone C (so D appears under A->C and B->C)
    const { memoryTree, command } = await fullCycle(startTree, async (ctx) => {
      await changeNodeTemplateAction(ctx, 'D', 't-2');
    });

    const instanceUnderA = memoryTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!.children.find((d) => d.id === 'D')!;
    const instanceUnderB = memoryTree.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!.children.find((d) => d.id === 'D')!;

    // Both instances in memory must reflect the change
    expect(instanceUnderA.templateId, 'templateId of the instance under A').toBe('t-2');
    expect(instanceUnderA.data['f-common2']).toBe('Val D');
    expect(instanceUnderB.templateId, 'templateId of the instance under B').toBe('t-2');
    expect(instanceUnderB.data['f-common2']).toBe('Val D');

    assertConsistencyInvariant(memoryTree);
    assertInstancesConsistent(memoryTree.tree);

    // Undo
    const undoneTrees = await undoOn([memoryTree], command);
    const undoneTree = undoneTrees.find((t) => t.id === startTree.id)!;
    const undoneUnderA = undoneTree.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!.children.find((d) => d.id === 'D')!;
    expect(undoneUnderA.templateId).toBe('t-1');
    expect(undoneUnderA.data['f-common']).toBe('Val D');
  });

  /**
   * KNOWN BUG 4a: after changeNodeTemplateAction on a clone C, all instances of C are consistent
   * (currently findNodeAndParentInDraft only updates the first instance found in draft).
   */
  knownBug(
    'KNOWN BUG: (a) after changeNodeTemplateAction on clone C, all instances of C are consistent (assertInstancesConsistent)',
    /Instances inconsistent for node C/,
    async () => {
      const startTree = getStartingTree();
      const { memoryTree } = await fullCycle(startTree, async (ctx) => {
        await changeNodeTemplateAction(ctx, 'C', 't-2');
      });

      assertInstancesConsistent(memoryTree.tree);
    }
  );

  /**
   * KNOWN BUG 4b: after changeNodeTemplateAction on clone C AND then moving an unrelated node,
   * the new templateId and data are present in every instance of C.
   */
  knownBug(
    'KNOWN BUG: (b) after template change on clone C and moving unrelated node, new templateId and data are present in every instance of C',
    /templateIds of all instances of C after move: expected \[ 't-1', 't-1' \] to deeply equal \[ 't-2', 't-2' \]/,
    async () => {
      const startTree = getStartingTree();
      const { memoryTree } = await fullCycle(startTree, async (ctx) => {
        await changeNodeTemplateAction(ctx, 'C', 't-2');
      });

      const { memoryTree: treeAfterMove } = await fullCycle(memoryTree, async (ctx) => {
        await moveNodesAction(ctx, [
          {
            nodeId: 'B',
            targetNodeId: 'start',
            position: 'sibling',
            sourceContextualParentId: null,
            targetContextualParentId: null,
          },
        ]);
      });

      const instanceUnderA = treeAfterMove.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
      const instanceUnderB = treeAfterMove.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!;
      const ids = [instanceUnderA.templateId, instanceUnderB.templateId];

      expect(ids, 'templateIds of all instances of C after move').toEqual(['t-2', 't-2']);
    }
  );

  it('changeNodeTemplateAction on clone C: writes templateId to fake DB on post', async () => {
    const startTree = getStartingTree();
    await fullCycle(startTree, async (ctx) => {
      await changeNodeTemplateAction(ctx, 'C', 't-2');
    });

    const record = fakeDb.records.get('C');
    expect(record, 'record C exists in fake db').toBeDefined();
    expect(record!.templateId, 'db templateId').toBe('t-2');
  });

  /**
   * KNOWN BUG 5: changeMultipleNodesTemplateAction on a clone:
   * old and new templates share a field name, with data in that field.
   * Fake DB must preserve the same-named field value, but currently writes data as {}.
   */
  knownBug(
    'KNOWN BUG: changeMultipleNodesTemplateAction on a clone: preserves same-named field data in fake DB',
    /same-named field data preserved.*expected undefined to be 'Val C'/,
    async () => {
      const startTree = getStartingTree();
      fakeDb.reset();
      fakeDb.seedFromNodes(startTree.tree, startTree.id, startTree.userId);

      const reloadActiveTree = vi.fn(async () => {});
      const ctx = makeCtx(startTree, { reloadActiveTree });

      await changeMultipleNodesTemplateAction(ctx, ['C_A'], 't-2');

      expect(reloadActiveTree).toHaveBeenCalled();
      const record = fakeDb.records.get('C');
      expect(record, 'record C exists in fake db').toBeDefined();
      expect(record!.templateId, 'templateId was written').toBe('t-2');
      expect(record!.data['f-common2'], 'same-named field data preserved').toBe('Val C');
    }
  );

  it('control case: changeMultipleNodesTemplateAction on a NON-clone node preserves same-named field data', async () => {
    const startTree = getStartingTree();
    // Using fullCycle which executes the command and posts it to fakeDb
    const { memoryTree } = await fullCycle(startTree, async (ctx) => {
      await changeMultipleNodesTemplateAction(ctx, ['A_root'], 't-2');
    });

    const record = fakeDb.records.get('A');
    expect(record, 'record A exists in fake db').toBeDefined();
    expect(record!.templateId, 'templateId was written').toBe('t-2');
    expect(record!.data['f-common2'], 'same-named field data preserved').toBe('Val A');
  });
  /**
   * KNOWN BUG 4c: after template change on clone C, moving a third unrelated root node D
   * also causes C to revert across all instances because reconstructTree flattens the tree
   * into an allNodesMap where the second stale instance overwrites the updated first instance.
   */
  knownBug(
    'KNOWN BUG: (c) after template change on clone C and moving unrelated node D, all instances of C have the new templateId',
    /templateIds of all instances of C after unrelated move: expected \[ 't-1', 't-1' \] to deeply equal \[ 't-2', 't-2' \]/,
    async () => {
      // Tree with roots A, B, and unrelated root D
      // C is a cloned child under A and B
      const treeWithUnrelatedRoot = makeTree(
        [
          {
            id: 'A',
            templateId: 't-1',
            data: { 'f-common': 'Val A', 'f-extra1': 'Extra A' },
            children: [
              {
                id: 'C',
                templateId: 't-1',
                parentIds: ['A', 'B'],
                order: [0, 0],
                data: { 'f-common': 'Val C', 'f-extra1': 'Extra C' },
              },
            ],
          },
          {
            id: 'B',
            templateId: 't-1',
            data: { 'f-common': 'Val B' },
            children: [
              {
                id: 'C',
                templateId: 't-1',
                parentIds: ['A', 'B'],
                order: [0, 0],
                data: { 'f-common': 'Val C', 'f-extra1': 'Extra C' },
              },
            ],
          },
          {
            id: 'D',
            templateId: 't-1',
            order: [2],
            data: { 'f-common': 'Val D' },
          },
        ],
        'tree-1',
        'user-1',
        'Test Tree',
        [template1, template2]
      );

      const { memoryTree } = await fullCycle(treeWithUnrelatedRoot, async (ctx) => {
        await changeNodeTemplateAction(ctx, 'C', 't-2');
      });

      // Move unrelated root D to start of root list
      const { memoryTree: treeAfterMove } = await fullCycle(memoryTree, async (ctx) => {
        await moveNodesAction(ctx, [
          {
            nodeId: 'D',
            targetNodeId: 'start',
            position: 'sibling',
            sourceContextualParentId: null,
            targetContextualParentId: null,
          },
        ]);
      });

      const instanceUnderA = treeAfterMove.tree.find((n) => n.id === 'A')!.children.find((c) => c.id === 'C')!;
      const instanceUnderB = treeAfterMove.tree.find((n) => n.id === 'B')!.children.find((c) => c.id === 'C')!;
      const ids = [instanceUnderA.templateId, instanceUnderB.templateId];

      expect(ids, 'templateIds of all instances of C after unrelated move').toEqual(['t-2', 't-2']);
    }
  );
});
