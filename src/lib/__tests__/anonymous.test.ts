import { describe, it, expect, vi } from 'vitest';
import { Template } from '@/lib/types';
import { makeTree, describeTree, flatPlacements, defaultTemplate } from './fixtures';
import { fakeDb } from './fake-db';
import { executeOn, knownBug, fullCycle } from './harness';
import { makeCtx } from './ctx';
import {
  addRootNodeAction,
  addChildNodeAction,
  addSiblingNodeAction,
  addNodesAction,
  updateNodeAction,
  batchUpdateNodesDataAction,
  updateNodeNamesForTemplateAction,
  changeNodeTemplateAction,
  changeMultipleNodesTemplateAction,
  deleteNodeAction,
  deleteNodesAction,
  moveNodesAction,
  moveNodeOrderAction,
  toggleStarredForSelectedNodesAction,
  copyNodesAction,
  pasteNodesAsClonesAction,
} from '@/lib/node-actions';

describe('Anonymous Mode', () => {
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

  it('with currentUser null, addRootNodeAction completes using only execute and makes NO DB call', async () => {
    fakeDb.sessionUserId = null; // No auth
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await addRootNodeAction(ctx, { name: 'Anon Root' });

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];

    // execute mutates draft in memory
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.map((n) => n.id)).toContain('id-1');

    // fakeDb records should be untouched!
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, updateNodeAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await updateNodeAction(ctx, 'A', { name: 'Anon Updated A' });

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.name).toBe('Anon Updated A');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, deleteNodeAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await deleteNodeAction(ctx, 'C', 'A');

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.children.length).toBe(0);
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, moveNodesAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await moveNodesAction(ctx, [
      {
        nodeId: 'B',
        targetNodeId: 'start',
        position: 'sibling',
        sourceContextualParentId: null,
        targetContextualParentId: null,
      },
    ]);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.map((n) => n.id)).toEqual(['B', 'A']);
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });


  it('with currentUser null, addChildNodeAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await addChildNodeAction(ctx, 'A', { name: 'Anon Child' }, 'A');

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    const nodeA = newTrees[0].tree.find((n) => n.id === 'A')!;
    expect(nodeA.children.map((c) => c.name)).toContain('Anon Child');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, addSiblingNodeAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await addSiblingNodeAction(ctx, 'A', { name: 'Anon Sibling' }, null);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.map((n) => n.name)).toContain('Anon Sibling');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, addNodesAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await addNodesAction(ctx, [
      {
        name: 'Bulk Anon Node',
        treeId: tree.id,
        parentIds: ['root'],
        order: [2],
      } as any,
    ]);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.map((n) => n.name)).toContain('Bulk Anon Node');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, batchUpdateNodesDataAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await batchUpdateNodesDataAction(ctx, ['A_root'], { 'f-title': 'Updated Data' });

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.data['f-title']).toBe('Updated Data');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, updateNodeNamesForTemplateAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const template = { ...defaultTemplate(), nameTemplate: 'T: {title}' };
    const tree = makeTree([
      { id: 'A', name: 'Old A', data: { 'f-title': 'Alpha' } },
    ], 'tree-1', 'anon-user', 'Tree', [template]);
    const ctx = makeCtx(tree, { currentUser: null });

    await updateNodeNamesForTemplateAction(ctx, template);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.name).toBe('T: Alpha');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, changeNodeTemplateAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const template2: Template = { id: 't-2', name: 'T2', fields: [{ id: 'f-title', name: 'title', type: 'text' }], conditionalRules: [] };
    const tree = makeTree([
      { id: 'A', name: 'A', templateId: 't-default', data: { 'f-title': 'Val A' } },
    ], 'tree-1', 'anon-user', 'Tree', [defaultTemplate(), template2]);
    const ctx = makeCtx(tree, { currentUser: null });

    await changeNodeTemplateAction(ctx, 'A', 't-2');

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.templateId).toBe('t-2');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, changeMultipleNodesTemplateAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const template2: Template = { id: 't-2', name: 'T2', fields: [{ id: 'f-title', name: 'title', type: 'text' }], conditionalRules: [] };
    const tree = makeTree([
      { id: 'A', name: 'A', templateId: 't-default', data: { 'f-title': 'Val A' } },
    ], 'tree-1', 'anon-user', 'Tree', [defaultTemplate(), template2]);
    const ctx = makeCtx(tree, { currentUser: null, reloadActiveTree: vi.fn() });

    await changeMultipleNodesTemplateAction(ctx, ['A_root'], 't-2');

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.templateId).toBe('t-2');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, deleteNodesAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await deleteNodesAction(ctx, ['A_root']);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')).toBeUndefined();
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, moveNodeOrderAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = makeTree([
      { id: 'A', order: [0] },
      { id: 'B', order: [1] },
    ]);
    const ctx = makeCtx(tree, { currentUser: null });

    await moveNodeOrderAction(ctx, 'A', 'down', null);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.map((n) => n.id)).toEqual(['B', 'A']);
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, toggleStarredForSelectedNodesAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null, selectedNodeIds: ['A'] });

    await toggleStarredForSelectedNodesAction(ctx);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    expect(newTrees[0].tree.find((n) => n.id === 'A')!.isStarred).toBe(true);
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, copyNodesAction completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const nodeA = tree.tree.find((n) => n.id === 'A')!;
    const ctx = makeCtx(tree, {
      currentUser: null,
      clipboard: { nodes: [nodeA], operation: 'copy' },
    });

    await copyNodesAction(ctx, 'B', 'child', null, [nodeA]);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    const nodeB = newTrees[0].tree.find((n) => n.id === 'B')!;
    expect(nodeB.children.length).toBeGreaterThan(1);
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  it('with currentUser null, pasteNodesAsClonesAction as child completes without DB call', async () => {
    fakeDb.sessionUserId = null;
    const tree = getStartingTree();
    const ctx = makeCtx(tree, { currentUser: null });

    await pasteNodesAsClonesAction(ctx, 'B', 'child', ['A'], null);

    expect(ctx.capturedCommands.length).toBe(1);
    const { command } = ctx.capturedCommands[0];
    const newTrees = executeOn([tree], command);
    const nodeB = newTrees[0].tree.find((n) => n.id === 'B')!;
    expect(nodeB.children.map((c) => c.id)).toContain('A');
    expect(fakeDb.calls.length).toBe(0);
    expect(fakeDb.records.size).toBe(0);
  });

  /**
   * KNOWN BUG 6: anonymous user pasting as clone with 'sibling':
   * no server call must be made (currently reorderSiblingsForAdd is called before the command exists).
   */
  knownBug(
    "KNOWN BUG: anonymous user pasting as clone with 'sibling': no server call must be made",
    /Authentication required/,
    async () => {
      fakeDb.sessionUserId = null; // No auth in DB!
      const tree = getStartingTree();
      const ctx = makeCtx(tree, { currentUser: null });

      // In pasteNodesAsClonesAction (line 1393):
      // if position === 'sibling', it calls:
      // await reorderSiblingsForAdd(activeTree.id, newParentId, newOrder);
      // BEFORE executeCommand!
      // For anonymous users, reorderSiblingsForAdd throws "Authentication required."
      await pasteNodesAsClonesAction(ctx, 'B', 'sibling', ['A'], null);

      expect(ctx.capturedCommands.length).toBe(1);
    }
  );

  it('positive control: with a logged-in session, fullCycle records calls in fakeDb.calls', async () => {
    fakeDb.sessionUserId = 'user-1';
    const tree = getStartingTree();

    expect(fakeDb.calls.length).toBe(0);

    await fullCycle(tree, async (ctx) => {
      await updateNodeAction(ctx, 'A', { name: 'Logged-in Updated A' });
    });

    expect(fakeDb.calls.length).toBeGreaterThan(0);
    expect(fakeDb.calls.some((c) => c.method === 'batchUpdateNodes' || c.method === 'updateNode')).toBe(true);
  });
});

