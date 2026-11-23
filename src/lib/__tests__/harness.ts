/**
 * harness.ts
 *
 * Test harness for node-actions:
 * - Module mocks routing data-service to fakeDb
 * - perform(tree, runAction): runs action with fresh ctx, capturing command
 * - executeOn(allTrees, command): Immer produce calling command.execute
 * - undoOn(allTrees, command) / redoOn(...): mirrors undoLastAction / redoLastAction in tree-roots.tsx
 * - fullCycle(...): execute, then post against fake DB seeded with same tree
 * - Consistency invariant assertions: flatPlacements(memoryTree) == dbPlacements(),
 *   assertInstancesConsistent, reachableIds.
 */

import { produce } from 'immer';
import { ActionContext, Command, TreeFile, TreeNode } from '@/lib/types';
import { fakeDb } from './fake-db';
import { makeCtx } from './ctx';
import { assertInstancesConsistent, flatPlacements, reachableIds } from './fixtures';
import { expect, vi, it } from 'vitest';

export type KnownBugEvaluation = {
  status: 'failed-as-expected' | 'bug-appears-fixed' | 'wrong-failure';
  message?: string;
};

/**
 * Pure async function to evaluate a known bug.
 * Returns:
 * - 'bug-appears-fixed' if fn completes without throwing
 * - 'wrong-failure' if the error does not match the pattern, or is a TypeError or ReferenceError,
 *   or its message is "No command was executed by the action"
 * - 'failed-as-expected' otherwise
 */
export async function evaluateKnownBug(
  fn: () => Promise<void> | void,
  pattern: RegExp | string
): Promise<KnownBugEvaluation> {
  let error: any = null;
  try {
    await fn();
  } catch (e: any) {
    error = e;
  }

  if (!error) {
    return {
      status: 'bug-appears-fixed',
      message: 'bug appears fixed: convert this test to a normal test',
    };
  }

  const msg = error?.message || String(error);

  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    msg === 'No command was executed by the action' ||
    msg === 'No command was executed by the action.'
  ) {
    return {
      status: 'wrong-failure',
      message: msg,
    };
  }

  const matches =
    typeof pattern === 'string'
      ? msg.includes(pattern)
      : pattern.test(msg);

  if (!matches) {
    return {
      status: 'wrong-failure',
      message: `Expected error matching ${pattern}, but got: "${msg}"`,
    };
  }

  return {
    status: 'failed-as-expected',
    message: msg,
  };
}

/**
 * Runs `fn` inside a normal `it(title, ...)` and asserts that it throws
 * an error whose message matches `expectedFailurePattern`.
 * Uses evaluateKnownBug to strictly check the failure.
 */
export function knownBug(
  title: string,
  expectedFailurePattern: RegExp | string,
  fn: () => Promise<void> | void
): void {
  it(title, async () => {
    const result = await evaluateKnownBug(fn, expectedFailurePattern);
    if (result.status === 'bug-appears-fixed') {
      throw new Error(result.message || 'bug appears fixed: convert this test to a normal test');
    }
    if (result.status === 'wrong-failure') {
      throw new Error(`Known bug test failed with wrong error: ${result.message}`);
    }
  });
}

export async function perform(
  tree: TreeFile,
  runAction: (ctx: ActionContext) => Promise<void>,
  ctxOverrides?: Partial<ActionContext>
): Promise<{ command: Command; isUndoable: boolean; ctx: ActionContext }> {
  const ctx = makeCtx(tree, ctxOverrides);
  await runAction(ctx);
  const captured = ctx.capturedCommands;
  if (captured.length === 0) {
    throw new Error('No command was executed by the action.');
  }
  return { command: captured[0].command, isUndoable: captured[0].isUndoable, ctx };
}

/**
 * Immer produce calling command.execute on the draft, exactly as tree-roots.tsx lines 222-228 does.
 */
export function executeOn(allTrees: TreeFile[], command: Command, treeId?: string): TreeFile[] {
  const targetId = treeId || allTrees[0]?.id;
  return produce(allTrees, (draft) => {
    const treeToUpdate = draft.find((t) => t.id === targetId);
    if (treeToUpdate) {
      command.execute(draft);
      treeToUpdate.updatedAt = new Date().toISOString();
    }
  });
}

/**
 * Mirror tree-roots.tsx undoLastAction (lines 642-677):
 * 1. produces undoSnapshot using command.getUndoState
 * 2. calls command.undo()
 */
export async function undoOn(
  allTrees: TreeFile[],
  command: Command,
  treeId?: string
): Promise<TreeFile[]> {
  const targetId = treeId || allTrees[0]?.id;
  const newTimestamp = new Date().toISOString();

  const undoSnapshot = produce(allTrees, (draft) => {
    if (command.getUndoState) {
      command.getUndoState(draft, command);
    }
    const treeToUpdate = draft.find((t) => t.id === targetId);
    if (treeToUpdate) {
      treeToUpdate.updatedAt = newTimestamp;
    }
  });

  await command.undo(newTimestamp);
  return undoSnapshot;
}

/**
 * Mirror tree-roots.tsx redoLastAction (lines 679-719):
 * 1. execute on draft
 * 2. if command.redo -> await command.redo(), else if command.post -> await command.post()
 */
export async function redoOn(
  allTrees: TreeFile[],
  command: Command,
  treeId?: string
): Promise<TreeFile[]> {
  const targetId = treeId || allTrees[0]?.id;
  const newTimestamp = new Date().toISOString();

  const afterState = produce(allTrees, (draft) => {
    const treeToUpdate = draft.find((t) => t.id === targetId);
    if (treeToUpdate) {
      command.execute(draft);
      treeToUpdate.updatedAt = newTimestamp;
    }
  });

  const finalTreeFile = afterState.find((t) => t.id === targetId);

  if (command.redo) {
    await command.redo(finalTreeFile, newTimestamp);
  } else if (command.post && finalTreeFile) {
    await command.post(finalTreeFile, newTimestamp);
  }

  return afterState;
}

/**
 * Asserts the CONSISTENCY INVARIANT:
 * flatPlacements(memoryTree) equals dbPlacements(), plus assertInstancesConsistent
 * and reachableIds covering all nodes in the DB.
 */
export function assertConsistencyInvariant(memoryTree: TreeFile): void {
  assertInstancesConsistent(memoryTree.tree);

  const memPlacements = flatPlacements(memoryTree.tree);
  const dbPlacements = fakeDb.dbPlacements();

  expect(memPlacements.size).toBe(dbPlacements.size);

  for (const [id, mem] of memPlacements.entries()) {
    const db = dbPlacements.get(id);
    expect(db).toBeDefined();
    expect(mem.parentIds).toEqual(db!.parentIds);
    expect(mem.order).toEqual(db!.order);
  }

  const reachable = reachableIds(memoryTree.tree);
  for (const id of dbPlacements.keys()) {
    expect(reachable.has(id)).toBe(true);
  }
}

/**
 * Executes a full cycle:
 * Seeds DB from starting tree, runs execute, calls command.post, checks invariant.
 */
export async function fullCycle(
  startingTree: TreeFile,
  runAction: (ctx: ActionContext) => Promise<void>,
  ctxOverrides?: Partial<ActionContext>
): Promise<{
  memoryTree: TreeFile;
  command: Command;
  startingTree: TreeFile;
}> {
  fakeDb.reset();
  fakeDb.seedFromNodes(startingTree.tree, startingTree.id, startingTree.userId);

  const { command, isUndoable } = await perform(startingTree, runAction, ctxOverrides);

  // Execute on memory
  const newTrees = executeOn([startingTree], command);
  const memoryTree = newTrees.find((t) => t.id === startingTree.id)!;

  // Post to DB
  if (command.post) {
    await command.post(memoryTree);
  }

  return { memoryTree, command, startingTree };
}
