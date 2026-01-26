/**
 * @fileoverview
 * This module contains all the functions for performing actions on tree nodes.
 * These functions are designed to be called from the `useTreeRoots` hook and
 * encapsulate the logic for creating and executing commands for undo/redo,
 * as well as calling the necessary database services.
 */
"use client";

import {
  TreeNode,
  Template,
  Command,
  UpdateTreeFileCommand,
  AddNodesCommand,
  UpdateNodesCommand,
  DeleteNodesCommand,
  MoveNodesCommand,
  ClipboardState,
  User,
  TreeFile,
  ReorderNodesCommand,
  ActionContext,
  PasteAsClonesCommand,
  UseTreeRootsResult,
  TreeContextType,
} from '@/lib/types';
import {
  createNode as createNodeInDb,
  updateNode as updateNodeInDb,
  batchUpdateNodes,
  addParentToNode,
  reorderSiblingsForAdd,
  resequenceSiblings,
  batchCreateNodes,
  batchDeleteNodes,
  removeParentFromNode,
  findNodeById,
} from '@/lib/data-service';
import { generateNodeName, deepCloneNode, getContextualOrder, generateClientSideId } from '@/lib/utils';
import { WritableDraft } from "immer";
import { arrayMove } from "@dnd-kit/sortable";
import { useToast } from '@/hooks/use-toast';

// Local helper function to avoid reference errors.
const findNodeAndParentInDraft = (nodeId: string, nodes: WritableDraft<TreeNode>[]): { node: WritableDraft<TreeNode>; parent: WritableDraft<TreeNode> | null } | null => {
    for (const node of nodes) {
        if (node.id === nodeId) {
            return { node, parent: null };
        }
        if (node.children) {
            const found = findNodeAndParentInDraft(nodeId, node.children);
            if (found) {
                return { ...found, parent: found.parent || node };
            }
        }
    }
    return null;
};

// Re-creates the nested `children` array structure from a flat list of nodes with `parentIds`.
const reconstructTree = (nodes: (TreeNode | WritableDraft<TreeNode>)[]): WritableDraft<TreeNode>[] => {
  const nodeMap = new Map<string, WritableDraft<TreeNode>>();
  // First pass: Create a new mutable object for each node to avoid read-only errors.
  nodes.forEach(node => {
    // This spread creates a new object that Immer can safely mutate.
    const mutableNode = { ...node, children: [] } as WritableDraft<TreeNode>;
    nodeMap.set(mutableNode.id, mutableNode);
  });

  const rootNodes: WritableDraft<TreeNode>[] = [];

  // Second pass: Build the hierarchy using object references from our mutable map.
  nodeMap.forEach(node => {
    const parentIds = (node.parentIds && node.parentIds.length > 0) ? node.parentIds : ['root'];
    
    parentIds.forEach(parentId => {
      if (parentId === 'root') {
        if (!rootNodes.some(rn => rn.id === node.id)) {
            // Push the mutable version from the map
            rootNodes.push(nodeMap.get(node.id)!);
        }
      } else {
        const parent = nodeMap.get(parentId);
        if (parent) {
          if (!parent.children.some(child => child.id === node.id)) {
             // Push the mutable version from the map
             parent.children.push(nodeMap.get(node.id)!);
          }
        }
      }
    });
  });
  
  const sortChildrenRecursive = (nodesToSort: WritableDraft<TreeNode>[], parentId: string | null) => {
    if (!nodesToSort || nodesToSort.length === 0) return;
    nodesToSort.sort((a, b) => getContextualOrder(a, nodesToSort, parentId) - getContextualOrder(b, nodesToSort, parentId));
    nodesToSort.forEach(node => {
        if (node.children && node.children.length > 0) {
            sortChildrenRecursive(node.children, node.id);
        }
    });
  };
  
  // Sort all children at every level
  nodeMap.forEach(node => {
      if (node.children) {
          sortChildrenRecursive(node.children, node.id);
      }
  });
  sortChildrenRecursive(rootNodes, null);
  
  return rootNodes;
};


// Resequences the order property of siblings within an Immer draft.
const resequenceSiblingsInDraft = (
    siblings: WritableDraft<TreeNode>[],
    parentId: string | null
  ) => {
    const key = parentId ?? 'root';
    
    const sortedSiblings = [...siblings].sort((a, b) => getContextualOrder(a, siblings, parentId) - getContextualOrder(b, siblings, parentId));

    sortedSiblings.forEach((sibling, index) => {
      const pIndex = (sibling.parentIds || []).indexOf(key);
      if (pIndex !== -1) {
        const nodeInDraft = siblings.find(s => s.id === sibling.id);
        if(nodeInDraft) {
          const newOrder = [...nodeInDraft.order];
          newOrder[pIndex] = index; // Explicitly set to zero-based index
          nodeInDraft.order = newOrder;
        }
      }
    });
  };
  


// Internal helper for node creation
export async function addNodesAction(
    ctx: ActionContext,
    nodesToAdd: (Omit<TreeNode, 'id' | 'children'> & { _id?: string; id?: string, children?: any[] })[]
  ): Promise<void> {
    const { activeTree, currentUser, executeCommand, findNodeAndParent } = ctx;
    if (!nodesToAdd.length || !activeTree?.id) return;

    const nodesWithIds = nodesToAdd.map(n => {
        const newId = n.id || generateClientSideId();
        return {
            ...n,
            id: newId,
            _id: newId,
        };
    });
    
    const firstNode = nodesWithIds[0];
    const parentIdForSequencing = firstNode.parentIds?.[0] || 'root';
    const parentNode = parentIdForSequencing === 'root' ? null : findNodeAndParent(parentIdForSequencing, activeTree.tree)?.node;
    const siblings = parentNode ? parentNode.children : (activeTree.tree || []);
    
    const order = getContextualOrder(firstNode as any, siblings, parentIdForSequencing === 'root' ? null : parentIdForSequencing);

    const originalSiblingOrders = (siblings || [])
        .filter(s => getContextualOrder(s, siblings, parentIdForSequencing === 'root' ? null : parentIdForSequencing) >= order)
        .map(s => ({ id: s.id, order: [...s.order] }));
      
    const flattenedNodesForDb: any[] = [];
    const flattenAndPrep = (nodes: any[], parentId: string | null) => {
        nodes.forEach(node => {
            const { children, ...rest } = node;
            flattenedNodesForDb.push({
                ...rest,
                order: node.order, 
                treeId: activeTree.id,
                userId: currentUser?.id,
            });
            if (children) {
                flattenAndPrep(children, node.id);
            }
        });
    };
    flattenAndPrep(nodesWithIds, parentIdForSequencing === 'root' ? null : parentIdForSequencing);
    
    const command: AddNodesCommand = {
      type: 'ADD_NODES',
      payload: { nodes: nodesWithIds as TreeNode[] },
      originalState: { siblingOrders: originalSiblingOrders },
      execute: (draft: WritableDraft<TreeFile[]>) => {
          const treeToUpdate = draft.find((t: TreeFile) => t.id === activeTree.id);
          if (!treeToUpdate) return;

          const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
          const flattenAndMap = (nodes: WritableDraft<TreeNode>[]) => {
            nodes.forEach(node => {
                allNodesMap.set(node.id, node);
                if (node.children) flattenAndMap(node.children);
            });
          };
          flattenAndMap(treeToUpdate.tree);
          
          // --- Optimistic UI Update for Sibling Order ---
          const parentKey = parentIdForSequencing === 'root' ? null : parentIdForSequencing;
          const parentNodeInDraft = parentKey ? allNodesMap.get(parentKey) : null;
          const siblingsInDraft = parentNodeInDraft ? parentNodeInDraft.children : treeToUpdate.tree;
          
          const topLevelNodesCount = nodesWithIds.filter(n => n.parentIds.includes(parentKey || 'root')).length;

          siblingsInDraft.forEach(sibling => {
            const contextualOrder = getContextualOrder(sibling, siblingsInDraft, parentKey);
            if (contextualOrder >= order) {
              const pIndex = (sibling.parentIds || []).indexOf(parentKey || 'root');
              if (pIndex !== -1) {
                const newOrder = [...sibling.order];
                newOrder[pIndex] = contextualOrder + topLevelNodesCount; 
                sibling.order = newOrder;
              }
            }
          });
          
          // Add the new nodes to the map
          nodesWithIds.forEach(newNode => {
              allNodesMap.set(newNode.id, {...newNode, children: []} as WritableDraft<TreeNode>);
          });

          treeToUpdate.tree = reconstructTree(Array.from(allNodesMap.values()));
      },
      post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
          await reorderSiblingsForAdd(activeTree.id, parentIdForSequencing === 'root' ? null : parentIdForSequencing, order, timestamp);
          await batchCreateNodes([...flattenedNodesForDb].reverse(), timestamp);
      },
      undo: async (timestamp?: string) => {
        const undoUpdates: {id: string, updates: Partial<TreeNode>}[] = [];
        command.originalState.siblingOrders.forEach(sibling => {
            undoUpdates.push({id: sibling.id, updates: { order: sibling.order }});
        });

        await Promise.all([
            batchDeleteNodes(command.payload.nodes.map(node => ({
                nodeId: node.id,
                parentIdToUnlink: null // The entire node is deleted on undo
            })), timestamp),
            batchUpdateNodes(undoUpdates, timestamp)
        ]);
      },
      redo: async (finalTreeFile?: TreeFile, timestamp?: string) => {
        const parentId = command.payload.nodes[0].parentIds?.[0] || 'root';
        const parentNodeForRedo = parentId === 'root' ? null : findNodeAndParent(parentId, finalTreeFile?.tree || [])?.node;
        const siblingsForRedo = parentNodeForRedo ? parentNodeForRedo.children : finalTreeFile?.tree || [];
        const baseOrder = command.payload.nodes[0].order[0];
    
        await reorderSiblingsForAdd(activeTree.id, parentId === 'root' ? null : parentId, baseOrder, timestamp);
        await batchCreateNodes([...flattenedNodesForDb].reverse(), timestamp);
    
        if (finalTreeFile) {
          const finalParentNode = parentId === 'root' ? null : findNodeAndParent(parentId, finalTreeFile.tree)?.node;
          const finalSiblings = finalParentNode ? finalParentNode.children : finalTreeFile.tree;
    
          const siblingOrderUpdates = (finalSiblings || [])
            .map((sibling) => {
              const contextualOrder = getContextualOrder(sibling, finalSiblings, parentId === 'root' ? null : parentId);
              const parentIndex = (sibling.parentIds || []).indexOf(parentId || "root");
              if (parentIndex === -1) return null;
              
              const newOrder = [...sibling.order];
              newOrder[parentIndex] = contextualOrder;
    
              if (JSON.stringify(sibling.order) !== JSON.stringify(newOrder)) {
                return { id: sibling.id, updates: { order: newOrder } };
              }
              return null;
            })
            .filter((u): u is { id: string; updates: { order: number[] } } => u !== null);
    
          if (siblingOrderUpdates.length > 0) {
            await batchUpdateNodes(siblingOrderUpdates, timestamp);
          }
        }
      },
      getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
          const { activeTreeId } = ctx;
          const treeToUpdate = draft.find((t) => t.id === activeTreeId);
          if (treeToUpdate) {
              const nodesToRemove = new Set((command as AddNodesCommand).payload.nodes.map(n => n.id));
              
              const allNodesMap = new Map<string, WritableDraft<TreeNode>>();

              const flatten = (nodes: WritableDraft<TreeNode>[]) => {
                  nodes.forEach(n => {
                      allNodesMap.set(n.id, n);
                      if (n.children) flatten(n.children);
                  });
              };
              flatten(treeToUpdate.tree);
              
              // Restore sibling order
              (command as AddNodesCommand).originalState.siblingOrders.forEach(siblingOrder => {
                const nodeInMap = allNodesMap.get(siblingOrder.id);
                if (nodeInMap) {
                    (nodeInMap as WritableDraft<TreeNode>).order = [...siblingOrder.order];
                }
              });

              const remainingNodes = Array.from(allNodesMap.values()).filter(n => !nodesToRemove.has(n.id));
              treeToUpdate.tree = reconstructTree(remainingNodes);
          }
      },
    };
    
    await executeCommand(command, true);
  }

export async function addRootNodeAction(
  ctx: ActionContext,
  nodeData: Partial<Omit<TreeNode, 'id' | 'children'>>
) {
    const { activeTree, currentUser } = ctx;
    if (!activeTree) return; // Should not happen if called from UI with active tree
    
    const fullNodeData = {
      ...nodeData,
      treeId: activeTree.id,
      userId: currentUser?.id,
      parentIds: ['root'],
      order: [(activeTree.tree || []).length],
    } as Omit<TreeNode, 'id' | 'children' >;

    await addNodesAction(ctx, [fullNodeData]);
}

export async function addChildNodeAction(
  ctx: ActionContext,
  parentNodeId: string,
  childNodeData: Partial<Omit<TreeNode, "id" | "children">>,
  contextualParentId: string | null
) {
    const { activeTree, currentUser, findNodeAndParent } = ctx;
    if (!activeTree) return; 
    const parentNode = findNodeAndParent(parentNodeId, activeTree.tree)?.node;
    const children = parentNode?.children || [];
    
    const maxOrder = children.length > 0 
        ? Math.max(...children.map(c => getContextualOrder(c, children, parentNodeId))) 
        : -1;
    const newOrder = maxOrder + 1;

    const fullNodeData = {
        ...childNodeData,
        treeId: activeTree.id,
        userId: currentUser?.id,
        parentIds: [parentNodeId],
        order: [newOrder],
    } as Omit<TreeNode, 'id' | 'children'>;

    await addNodesAction(ctx, [fullNodeData]);
}

export async function addSiblingNodeAction(
  ctx: ActionContext,
  siblingNodeId: string, 
  nodeToAddData: Partial<Omit<TreeNode, 'id' | 'children'>>, 
  contextualParentId: string | null
) {
    const { activeTree, currentUser, findNodeAndContextualParent } = ctx;
    if (!activeTree) return;
    const parentInfo = findNodeAndContextualParent(siblingNodeId, contextualParentId, activeTree.tree);
    const parentNode = parentInfo?.parent;
    const siblings = parentNode ? parentNode.children : (activeTree.tree || []);
    const siblingNode = siblings.find(s => s.id === siblingNodeId);

    if (!siblingNode) return;
    
    const newOrder = getContextualOrder(siblingNode, siblings, contextualParentId) + 1;
    
    const fullNodeData = {
        ...nodeToAddData,
        treeId: activeTree.id,
        userId: currentUser?.id,
        parentIds: [parentNode?.id || 'root'],
        order: [newOrder],
    } as Omit<TreeNode, 'id' | 'children'>;

    await addNodesAction(ctx, [fullNodeData]);
}

export async function updateNodeAction(
    ctx: ActionContext,
    nodeId: string, 
    newNodeData: Partial<Omit<TreeNode, 'id' | 'children'>>
) {
    const { activeTree, activeTreeId, executeCommand, findNodeAndParent } = ctx;
    if (!activeTree) return;
    const nodeInfo = findNodeAndParent(nodeId, activeTree.tree);
    if (!nodeInfo) return;
    const originalNode = { ...nodeInfo.node, data: {...nodeInfo.node.data} }; // Deep enough copy for this
    
    const command: UpdateNodesCommand = {
        type: 'UPDATE_NODES',
        payload: [{ nodeId, updates: newNodeData, originalData: { name: originalNode.name, data: originalNode.data, order: originalNode.order, parentIds: originalNode.parentIds, isStarred: originalNode.isStarred, templateId: originalNode.templateId } }],
        execute: (draft: WritableDraft<TreeFile[]>) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
            if (!tree) return;
            
            const updateAllInstances = (nodes: WritableDraft<TreeNode>[]) => {
                for (const node of nodes) {
                    if (node.id === nodeId) {
                        Object.assign(node, newNodeData);
                    }
                    if (node.children) {
                        updateAllInstances(node.children);
                    }
                }
            };
            updateAllInstances(tree);
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
            await updateNodeInDb(nodeId, newNodeData, timestamp);
        },
        undo: async (timestamp?: string) => {
            const { originalData } = command.payload[0];
            await updateNodeInDb(nodeId, originalData, timestamp);
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
            const { nodeId, originalData } = (command as UpdateNodesCommand).payload[0];
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
            if (!tree) return;

            const updateAllInstances = (nodes: WritableDraft<TreeNode>[]) => {
                for (const node of nodes) {
                    if (node.id === nodeId) {
                        Object.assign(node, originalData);
                    }
                    if (node.children) {
                        updateAllInstances(node.children);
                    }
                }
            };
            updateAllInstances(tree);
        }
    };
    await executeCommand(command);
}

export async function batchUpdateNodesDataAction(
    ctx: ActionContext,
    instanceIds: string[],
    data: Record<string, any>
  ) {
    const { activeTree, activeTreeId, executeCommand, findNodeAndParent } = ctx;
    if (!activeTree || instanceIds.length === 0) return;
  
    const nodeIds = Array.from(new Set(instanceIds.map(id => id.split('_')[0])));
  
    const updatesPayload: { nodeId: string; updates: Partial<TreeNode>; originalData: Partial<TreeNode> }[] = [];
  
    nodeIds.forEach(nodeId => {
      const nodeInfo = findNodeAndParent(nodeId, activeTree.tree);
      if (nodeInfo) {
        const originalNode = nodeInfo.node;
        // The update merges new data with existing data
        const newData = { ...originalNode.data, ...data };
        updatesPayload.push({
          nodeId,
          updates: { data: newData },
          originalData: { data: originalNode.data },
        });
      }
    });
  
    if (updatesPayload.length === 0) return;
  
    const command: UpdateNodesCommand = {
      type: 'UPDATE_NODES',
      payload: updatesPayload,
      execute: (draft: WritableDraft<TreeFile[]>) => {
        const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
        if (!tree) return;
        updatesPayload.forEach(({ nodeId, updates }) => {
          const node = findNodeAndParentInDraft(nodeId, tree)?.node;
          if (node) {
            // Important: Merge data, don't replace
            node.data = { ...node.data, ...(updates.data || {}) };
          }
        });
      },
      post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
        const dbUpdates = updatesPayload.map(p => ({ id: p.nodeId, updates: { data: p.updates.data } }));
        await batchUpdateNodes(dbUpdates, timestamp);
      },
      undo: async (timestamp?: string) => {
        const undoUpdates = updatesPayload.map(p => ({
          id: p.nodeId,
          updates: { data: p.originalData.data },
        }));
        await batchUpdateNodes(undoUpdates, timestamp);
      },
      getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
        const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
        if (!tree) return;
        (command as UpdateNodesCommand).payload.forEach(({ nodeId, originalData }) => {
          const node = findNodeAndParentInDraft(nodeId, tree)?.node;
          if (node) {
            node.data = originalData.data as WritableDraft<Record<string, any>>;
          }
        });
      }
    };
    await executeCommand(command);
  }

export async function updateNodeNamesForTemplateAction(ctx: ActionContext, template: Template) {
    const { activeTree, activeTreeId, executeCommand, findNodeAndParent } = ctx;
    if (!activeTree) return;
    
    const updates: { id: string; updates: Partial<TreeNode> }[] = [];
    const originalNodes: { [key: string]: Partial<TreeNode> } = {};

    const traverseAndCheck = (nodes: TreeNode[]) => {
        for (const node of nodes) {
            if (node.templateId === template.id) {
                const newName = generateNodeName(template, node.data);
                if (newName !== node.name) {
                    updates.push({ id: node.id, updates: { name: newName } });
                    originalNodes[node.id] = { name: node.name };
                }
            }
            if (node.children) traverseAndCheck(node.children);
        }
    };
    traverseAndCheck(activeTree.tree);

    if (updates.length > 0) {
        
        const command: UpdateNodesCommand = {
            type: 'UPDATE_NODES',
            payload: updates.map(u => ({ nodeId: u.id, updates: u.updates, originalData: originalNodes[u.id] })),
            execute: (draft: WritableDraft<TreeFile[]>) => {
                const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
                if (!tree) return;
                updates.forEach(({ id, updates }) => {
                    const nodeToUpdate = findNodeAndParentInDraft(id, tree)?.node;
                    if (nodeToUpdate) {
                        Object.assign(nodeToUpdate, updates);
                    }
                });
            },
            post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
                await batchUpdateNodes(updates, timestamp);
            },
            undo: async (timestamp?: string) => {
                const undoUpdates: {id: string, updates: Partial<TreeNode>}[] = [];
                updates.forEach(({ id }) => {
                    undoUpdates.push({ id, updates: originalNodes[id] });
                });
                await batchUpdateNodes(undoUpdates, timestamp);
            },
            getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
                const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
                if (!tree) return;
                (command as UpdateNodesCommand).payload.forEach(({ nodeId, originalData }) => {
                    const nodeToUpdate = findNodeAndParentInDraft(nodeId, tree)?.node;
                    if (nodeToUpdate) {
                        Object.assign(nodeToUpdate, originalData);
                    }
                });
            }
        };
        await executeCommand(command);
    }
}

export async function changeNodeTemplateAction(ctx: ActionContext, nodeId: string, newTemplateId: string) {
    const { activeTree, activeTreeId, executeCommand, findNodeAndParent } = ctx;
    if (!activeTree) return;
    
    const nodeInfo = findNodeAndParent(nodeId, activeTree.tree);
    if (!nodeInfo) return;
    const originalNode = nodeInfo.node;

    const newTemplate = activeTree.templates.find(t => t.id === newTemplateId);
    if (!newTemplate) return;

    const newData: Record<string, any> = {};
    const oldTemplate = activeTree.templates.find(t => t.id === originalNode.templateId);
    if (oldTemplate) {
        newTemplate.fields.forEach(newField => {
            const oldField = oldTemplate.fields.find(f => f.name === newField.name);
            if (oldField && originalNode.data[oldField.id] !== undefined) {
                newData[newField.id] = originalNode.data[oldField.id];
            }
        });
    }
    
    const updates = { templateId: newTemplateId, data: newData };
    
    const command: UpdateNodesCommand = {
        type: 'UPDATE_NODES',
        payload: [{ nodeId, updates, originalData: { templateId: originalNode.templateId, data: originalNode.data } }],
        execute: (draft: WritableDraft<TreeFile[]>) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
            if (!tree) return;
            const nodeToUpdate = findNodeAndParentInDraft(nodeId, tree)?.node;
            if (nodeToUpdate) Object.assign(nodeToUpdate, updates);
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
             await updateNodeInDb(nodeId, updates, timestamp);
        },
        undo: async (timestamp?: string) => {
            const originalData = { templateId: originalNode.templateId, data: originalNode.data };
            await updateNodeInDb(nodeId, originalData, timestamp);
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
            const originalData = { templateId: originalNode.templateId, data: originalNode.data };
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
            if (!tree) return;
            const nodeToUpdate = findNodeAndParentInDraft(nodeId, tree)?.node;
            if (nodeToUpdate) {
                Object.assign(nodeToUpdate, originalData);
            }
        }
    };
    await executeCommand(command);
}

export async function changeMultipleNodesTemplateAction(
    ctx: ActionContext,
    instanceIds: string[],
    newTemplateId: string
) {
    const { activeTree, activeTreeId, findNodeAndParent, executeCommand, isCloneOrDescendant, reloadActiveTree } = ctx;
    if (!activeTree) return;
    
    // For public users, perform a local-only update
    if (!ctx.currentUser && reloadActiveTree) {
        // This is a simplified local update. It is not undoable.
        const nodeIds = Array.from(new Set(instanceIds.map(id => id.split('_')[0])));
        const newTemplate = activeTree.templates.find(t => t.id === newTemplateId);
        if (!newTemplate) return;

        const updater = (draft: WritableDraft<TreeFile[]>) => {
            const treeToUpdate = draft.find(t => t.id === activeTreeId);
            if (!treeToUpdate) return;
            
            const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
            const flatten = (nodes: WritableDraft<TreeNode>[]) => nodes.forEach(n => { allNodesMap.set(n.id, n); if(n.children) flatten(n.children); });
            flatten(treeToUpdate.tree);

            nodeIds.forEach(nodeId => {
                const node = allNodesMap.get(nodeId);
                if (node) {
                    const oldTemplate = activeTree.templates.find(t => t.id === node.templateId);
                    const newData: Record<string, any> = {};
                    if (oldTemplate) {
                        newTemplate.fields.forEach(newField => {
                            const oldField = oldTemplate.fields.find(f => f.name === newField.name);
                            if (oldField && node.data[oldField.id] !== undefined) {
                                newData[newField.id] = node.data[oldField.id];
                            }
                        });
                    }
                    node.templateId = newTemplateId;
                    node.data = newData;
                }
            });
            treeToUpdate.tree = reconstructTree(Array.from(allNodesMap.values()));
        };
        ctx.executeCommand({ type: 'LOCAL_ONLY_UPDATE', execute: updater, undo: async () => {} }, false);
        return;
    }
    
    // Authenticated user flow
    const nodeIds = Array.from(new Set(instanceIds.map(id => id.split('_')[0])));

    if (isCloneOrDescendant && nodeIds.some(id => isCloneOrDescendant(id, activeTree.tree))) {
        const dbUpdates = nodeIds.map(id => ({ id, updates: { templateId: newTemplateId, data: {} } }));
        await batchUpdateNodes(dbUpdates);
        if (reloadActiveTree) await reloadActiveTree();
        return;
    }

    const updatesPayload: { nodeId: string; updates: Partial<TreeNode>; originalData: Partial<TreeNode> }[] = [];

    nodeIds.forEach(nodeId => {
        const nodeInfo = findNodeAndParent(nodeId, activeTree.tree);
        if (!nodeInfo) return;
        const originalNode = nodeInfo.node;

        const newTemplate = activeTree.templates.find(t => t.id === newTemplateId);
        if (!newTemplate) return;

        const newData: Record<string, any> = {};
        const oldTemplate = activeTree.templates.find(t => t.id === originalNode.templateId);
        if (oldTemplate) {
             newTemplate.fields.forEach(newField => {
                const oldField = oldTemplate.fields.find(f => f.name === newField.name);
                if (oldField && originalNode.data[oldField.id] !== undefined) {
                    newData[newField.id] = originalNode.data[oldField.id];
                }
            });
        }
        updatesPayload.push({
            nodeId,
            updates: { templateId: newTemplateId, data: newData },
            originalData: { templateId: originalNode.templateId, data: originalNode.data },
        });
    });

    
    const command: UpdateNodesCommand = {
        type: 'UPDATE_NODES',
        payload: updatesPayload.map(p => ({ nodeId: p.nodeId, updates: p.updates, originalData: p.originalData })),
        execute: (draft: WritableDraft<TreeFile[]>) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
            if (!tree) return;
            updatesPayload.forEach(({ nodeId, updates }) => {
                const node = findNodeAndParentInDraft(nodeId, tree)?.node;
                if (node) Object.assign(node, updates);
            });
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
            await batchUpdateNodes(updatesPayload.map(p => ({ id: p.nodeId, updates: p.updates })), timestamp);
        },
        undo: async (timestamp?: string) => {
            const undoUpdates: {id: string, updates: Partial<TreeNode>}[] = [];
            updatesPayload.forEach(({ nodeId, originalData }) => {
                undoUpdates.push({id: nodeId, updates: originalData});
            });
            await batchUpdateNodes(undoUpdates, timestamp);
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId)?.tree;
            if (!tree) return;
            (command as UpdateNodesCommand).payload.forEach(({ nodeId, originalData }) => {
                const node = findNodeAndParentInDraft(nodeId, tree)?.node;
                if (node) {
                    Object.assign(node, originalData);
                }
            });
        }
    };
    await executeCommand(command);
}

export async function deleteNodesAction(
  ctx: ActionContext,
  instanceIds: string[],
  sourceTree?: TreeNode[]
) {
  const { activeTree, activeTreeId, executeCommand, findNodeAndParent } = ctx;
  const treeToSearch = sourceTree || activeTree?.tree;
  if (!treeToSearch || instanceIds.length === 0) return;

  const preMutationMap = new Map<string, TreeNode>();
  const flattenOriginal = (nodes: TreeNode[]) => {
      nodes.forEach(n => {
          preMutationMap.set(n.id, JSON.parse(JSON.stringify(n)));
          if (n.children) flattenOriginal(n.children);
      });
  };
  flattenOriginal(treeToSearch);

  const nodesToDelete = instanceIds.map(instanceId => {
      const [nodeId, parentIdStr] = instanceId.split('_');
      return { nodeId, parentId: parentIdStr === 'root' ? null : parentIdStr };
  });

  const originalState: DeleteNodesCommand['originalState'] = [];

  for (const { nodeId, parentId } of nodesToDelete) {
      const nodeInfo = findNodeAndParent(nodeId, treeToSearch);
      if (nodeInfo) {
          const cleanNode = preMutationMap.get(nodeId) || nodeInfo.node;
          const allDescendantsAndSelf: TreeNode[] = [];
          const collect = (n: TreeNode) => {
              allDescendantsAndSelf.push(JSON.parse(JSON.stringify(n)));
              if (n.children) n.children.forEach(collect);
          };
          collect(cleanNode);

          originalState.push({
              node: JSON.parse(JSON.stringify(cleanNode)),
              parent: nodeInfo.parent ? JSON.parse(JSON.stringify(nodeInfo.parent)) : null,
              originalSiblings: JSON.parse(JSON.stringify(
                  nodeInfo.parent 
                      ? (preMutationMap.get(nodeInfo.parent.id)?.children || []) 
                      : treeToSearch
              )),
              allDeletedNodes: allDescendantsAndSelf,
          });
      }
  }

  const command: DeleteNodesCommand = {
      type: 'DELETE_NODES',
      payload: { nodes: nodesToDelete },
      originalState,
      post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
          await batchDeleteNodes(nodesToDelete.map(n => ({ nodeId: n.nodeId, parentIdToUnlink: n.parentId })), timestamp);
      },
      execute: (draft: WritableDraft<TreeFile[]>) => {
          const treeToUpdate = draft.find((t) => t.id === activeTreeId);
          if (!treeToUpdate) return;
          
          const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
          const flatten = (nodes: WritableDraft<TreeNode>[]) => {
              nodes.forEach(n => {
                  allNodesMap.set(n.id, n);
                  if (n.children) flatten(n.children);
              });
          };
          flatten(treeToUpdate.tree);

          const parentsToResequence = new Set<string | null>();
          const nodesToCheckForOrphans = new Set<string>();

          for (const { nodeId, parentId } of nodesToDelete) {
              const node = allNodesMap.get(nodeId);
              if (!node) continue;
              
              parentsToResequence.add(parentId);
              const pIdStr = parentId ?? 'root';
              const idx = (node.parentIds || []).indexOf(pIdStr);
              if (idx > -1) {
                  node.parentIds.splice(idx, 1);
                  node.order.splice(idx, 1);
              }
              nodesToCheckForOrphans.add(nodeId);
          }

          // FIX: If parentIds is empty, we MUST remove it from the map 
          // or reconstructTree will assume it's a root node.
          nodesToCheckForOrphans.forEach(id => {
            const node = allNodesMap.get(id);
            if (node && (!node.parentIds || node.parentIds.length === 0)) {
               // Also remove its descendants from the map to prevent "ghost" roots
               const removeRecursive = (n: WritableDraft<TreeNode>) => {
                 allNodesMap.delete(n.id);
                 if (n.children) n.children.forEach(removeRecursive);
               };
               removeRecursive(node);
            }
          });

          treeToUpdate.tree = reconstructTree(Array.from(allNodesMap.values()));
          
          // Re-map for resequencing
          allNodesMap.clear();
          flatten(treeToUpdate.tree);

          parentsToResequence.forEach(pId => {
              const siblings = pId ? allNodesMap.get(pId)?.children : treeToUpdate.tree;
              if (siblings) resequenceSiblingsInDraft(siblings, pId);
          });
      },
      undo: async (timestamp?: string) => {
        if (!activeTreeId) return;
    
        for (const state of command.originalState) {
            for (const node of state.allDeletedNodes) {
                const exists = await findNodeById(node.id);
                if (!exists) {
                    await batchCreateNodes([node], timestamp);
                } else {
                    await batchUpdateNodes([{
                        id: node.id, 
                        updates: { parentIds: node.parentIds, order: node.order }
                    }], timestamp);
                }
            }
        }
    
        const parents = new Set<string | null>();
        nodesToDelete.forEach(n => parents.add(n.parentId));
        for (const pId of parents) {
            await resequenceSiblings(pId, activeTreeId);
        }
    },
      getUndoState: (draft: WritableDraft<TreeFile[]>, cmd: Command) => {
          const treeToUpdate = draft.find((t) => t.id === activeTreeId);
          if (!treeToUpdate) return;

          const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
          const flatten = (nodes: WritableDraft<TreeNode>[]) => {
              nodes.forEach(n => {
                  allNodesMap.set(n.id, n);
                  if (n.children) flatten(n.children);
              });
          };
          flatten(treeToUpdate.tree);

          (cmd as DeleteNodesCommand).originalState.forEach(state => {
              state.allDeletedNodes.forEach(node => {
                  allNodesMap.set(node.id, JSON.parse(JSON.stringify(node)));
              });
              state.originalSiblings.forEach(sibling => {
                  allNodesMap.set(sibling.id, JSON.parse(JSON.stringify(sibling)));
              });
          });

          treeToUpdate.tree = reconstructTree(Array.from(allNodesMap.values()));

          allNodesMap.clear();
          flatten(treeToUpdate.tree);
          const parentsToFix = new Set<string | null>();
          nodesToDelete.forEach(n => parentsToFix.add(n.parentId));
          parentsToFix.forEach(pId => {
              const siblings = pId ? allNodesMap.get(pId)?.children : treeToUpdate.tree;
              if (siblings) resequenceSiblingsInDraft(siblings, pId);
          });
      }
  };

  await executeCommand(command);
}

export async function deleteNodeAction(ctx: ActionContext, nodeId: string, contextualParentId: string | null) {
    await deleteNodesAction(ctx, [`${nodeId}_${contextualParentId || 'root'}`]);
}

export async function copyNodesAction(
  ctx: ActionContext,
  targetNodeId: string,
  position: 'child' | 'sibling' | 'child-bottom',
  contextualParentId: string | null,
  nodes?: TreeNode[]
) {
  const { clipboard, activeTree, findNodeAndContextualParent } = ctx;
  const nodesToProcess = nodes || clipboard?.nodes;
  if (!nodesToProcess || !activeTree) return;

  const idMap = new Map<string, string>();
  const allNewNodesFlat: any[] = [];
  
  const parentInfo = findNodeAndContextualParent(targetNodeId, contextualParentId, activeTree.tree);
  if (!parentInfo) return;
  const { node: targetNode, parent: targetParent } = parentInfo;

  const newParentIdForTopNodes = (position === 'child' || position === 'child-bottom')
    ? targetNodeId
    : (targetParent?.id || 'root');
    
  const siblings = (newParentIdForTopNodes === 'root' ? activeTree.tree : findNodeAndContextualParent(newParentIdForTopNodes, null, activeTree.tree)?.node.children) || [];
  let newOrderForTopNodes;
  
  if (position === 'child' || position === 'child-bottom') {
      const childrenOfTarget = targetNode.children || [];
      newOrderForTopNodes = childrenOfTarget.length > 0 
          ? Math.max(...childrenOfTarget.map(c => getContextualOrder(c, childrenOfTarget, targetNodeId))) + 1 
          : 0;
  } else {
      newOrderForTopNodes = getContextualOrder(targetNode, siblings, newParentIdForTopNodes === 'root' ? null : newParentIdForTopNodes) + 1;
  }


  // Recursive function to clone, map IDs, and flatten
  const processHierarchy = (nodesToClone: TreeNode[]) => {
    nodesToClone.forEach((node, index) => {
      const newId = generateClientSideId();
      idMap.set(node.id, newId);

      const isTopLevel = nodesToProcess.some(n => n.id === node.id);

      const finalParentIds = isTopLevel 
        ? [newParentIdForTopNodes] 
        : node.parentIds.map(pid => idMap.get(pid)!).filter(Boolean);

      const { children, _id, id, ...rest } = node;
      
      const newOrderArray = [...node.order];
      const parentContextForOrder = isTopLevel ? newParentIdForTopNodes : (allNewNodesFlat.find(n => n.id === finalParentIds[0])?.parentIds?.[0] || 'root');
      
      const parentIndexForOrder = finalParentIds.indexOf(parentContextForOrder);

      if (isTopLevel) {
          if (parentIndexForOrder !== -1) {
              newOrderArray[parentIndexForOrder] = newOrderForTopNodes + index;
          } else {
              newOrderArray.push(newOrderForTopNodes + index);
          }
      }
      
      allNewNodesFlat.push({
        ...rest,
        id: newId,
        _id: newId,
        parentIds: finalParentIds,
        order: newOrderArray,
        children: [] 
      });

      if (children && children.length > 0) {
        processHierarchy(children);
      }
    });
  };

  processHierarchy(nodesToProcess);

  if (allNewNodesFlat.length > 0) {
    await addNodesAction(ctx, allNewNodesFlat);
  }
}

export async function moveNodesAction(
    ctx: ActionContext,
    moves: {
      nodeId: string;
      targetNodeId: string;
      position: "child" | "sibling" | "child-bottom";
      sourceContextualParentId: string | null;
      targetContextualParentId: string | null;
      isCutOperation?: boolean;
    }[]
  ) {
    const { activeTree, activeTreeId, executeCommand } = ctx;
    if (!activeTree || moves.length === 0) return;
  
    const originalTreeState = JSON.parse(JSON.stringify(activeTree.tree));
  
    const command: MoveNodesCommand = {
      type: "MOVE_NODES",
      payload: { moves },
      originalState: { tree: originalTreeState },
  
      post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
        if (!finalTreeFile) {
          console.warn("MoveNodes Post-op failed: Missing tree file states.");
          return;
        }
  
        const originalNodesMap = new Map<string, TreeNode>();
        const finalNodesMap = new Map<string, TreeNode>();
  
        const flatten = (nodes: TreeNode[], map: Map<string, TreeNode>) => {
          nodes.forEach((n) => {
            map.set(n.id, n);
            if (n.children) flatten(n.children, map);
          });
        };
        flatten(command.originalState.tree, originalNodesMap);
        flatten(finalTreeFile.tree, finalNodesMap);
  
        const updates: { id: string; updates: Partial<TreeNode> }[] = [];
  
        finalNodesMap.forEach((finalNode) => {
          const originalNode = originalNodesMap.get(finalNode.id);
          if (!originalNode) return;
  
          const orderChanged = JSON.stringify(finalNode.order) !== JSON.stringify(originalNode.order);
          const parentsChanged = JSON.stringify(finalNode.parentIds) !== JSON.stringify(originalNode.parentIds);
  
          if (orderChanged || parentsChanged) {
            updates.push({
              id: finalNode.id,
              updates: {
                parentIds: finalNode.parentIds,
                order: finalNode.order,
              },
            });
          }
        });
  
        if (updates.length > 0) {
          console.log(`INFO: Found ${updates.length} nodes with changed order/parentage. Batch updating DB.`);
          await batchUpdateNodes(updates, timestamp);
        } else {
          console.warn("WARN: No changes detected between original and final tree states. No DB update performed.");
        }
      },
  
      execute: (draft: WritableDraft<TreeFile[]>) => {
        const treeToUpdate = draft.find((t) => t.id === activeTreeId);
        if (!treeToUpdate) return;
  
        const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
        const flattenAndMap = (nodes: WritableDraft<TreeNode>[]) => {
          nodes.forEach((node) => {
            allNodesMap.set(node.id, node);
            if (node.children) flattenAndMap(node.children);
          });
        };
        flattenAndMap(treeToUpdate.tree);
  
        moves.forEach((move) => {
          const {
            nodeId,
            targetNodeId,
            position,
            sourceContextualParentId,
            targetContextualParentId,
          } = move;
  
          const nodeToMove = allNodesMap.get(nodeId);
          const targetNode = allNodesMap.get(targetNodeId);
  
          if (!nodeToMove || !targetNode) {
            console.warn(`Could not find nodeToMove (${nodeId}) or targetNode (${targetNodeId}) in draft.`);
            return;
          }
  
          const sourceKey = sourceContextualParentId ?? "root";
          const sourceParentNode = sourceKey === "root" ? null : allNodesMap.get(sourceKey);
          const sourceSiblings = sourceParentNode ? sourceParentNode.children : treeToUpdate.tree;
  
          const sourceIndex = sourceSiblings.findIndex((n) => n.id === nodeToMove.id);
          if (sourceIndex > -1) sourceSiblings.splice(sourceIndex, 1);
  
          const sourceParentIndexInNode = nodeToMove.parentIds.indexOf(sourceKey);
          if (sourceParentIndexInNode > -1) {
            nodeToMove.parentIds.splice(sourceParentIndexInNode, 1);
            nodeToMove.order.splice(sourceParentIndexInNode, 1);
          }
  
          const isChildDrop = position === "child" || position === "child-bottom";
          const newParentKey = isChildDrop ? targetNodeId : targetContextualParentId ?? "root";
          const newParentNode = newParentKey === "root" ? null : allNodesMap.get(newParentKey);
          const newSiblings = newParentNode ? newParentNode.children : treeToUpdate.tree;
  
          if (!nodeToMove.parentIds.includes(newParentKey)) {
            nodeToMove.parentIds.push(newParentKey);
            nodeToMove.order.push(-1); // placeholder, will be updated after resequencing
          }
  
          let targetIndex = newSiblings.findIndex((n) => n.id === targetNodeId);
          let insertIndex = isChildDrop ? newSiblings.length : targetIndex !== -1 ? targetIndex + 1 : newSiblings.length;
  
          if (isChildDrop) {
            targetNode.children.push(nodeToMove);
          } else {
            newSiblings.splice(insertIndex, 0, nodeToMove);
          }
  
          // Resequence destination siblings
          resequenceSiblingsInDraft(newSiblings, newParentKey === "root" ? null : newParentKey);
  
          // Resequence source siblings (if still valid)
          if (sourceSiblings.length > 0) {
            resequenceSiblingsInDraft(sourceSiblings, sourceKey === "root" ? null : sourceKey);
          }
          const sourceAffectedNodes = new Set<string>(sourceSiblings.map(n => n.id));
          sourceAffectedNodes.forEach((id) => {
            const instances = Array.from(allNodesMap.values()).filter((n) => n.id === id);
            instances.forEach((instance) => {
              instance.parentIds.forEach((pid, idx) => {
                const siblings = pid === "root" ? treeToUpdate.tree : allNodesMap.get(pid)?.children;
                if (!siblings) return;
                const orderIndex = siblings.findIndex((n) => n.id === id);
                if (orderIndex > -1) {
                  instance.order[idx] = orderIndex;
                }
              });
            });
          });          
          // Update all clones of affected siblings
          const affectedNodes = new Set<string>(newSiblings.map((n) => n.id));
          affectedNodes.forEach((id) => {
            const instances = Array.from(allNodesMap.values()).filter((n) => n.id === id);
            instances.forEach((instance) => {
              instance.parentIds.forEach((pid, idx) => {
                const siblings = pid === "root" ? treeToUpdate.tree : allNodesMap.get(pid)?.children;
                if (!siblings) return;
                const orderIndex = siblings.findIndex((n) => n.id === id);
                if (orderIndex > -1) {
                  instance.order[idx] = orderIndex;
                }
              });
            });
          });
  
          // Rebuild tree
          treeToUpdate.tree = reconstructTree(Array.from(allNodesMap.values()));
        });
      },
  
      undo: async (timestamp?: string) => {
        const updates: { id: string; updates: Partial<TreeNode> }[] = [];
        const originalTree = command.originalState.tree;
        const allNodesFromOriginal: TreeNode[] = [];
  
        const flatten = (nodes: TreeNode[]) => {
          nodes.forEach((n) => {
            allNodesFromOriginal.push(n);
            if (n.children) flatten(n.children);
          });
        };
        flatten(originalTree);
  
        for (const originalNode of allNodesFromOriginal) {
          updates.push({
            id: originalNode.id,
            updates: {
              parentIds: originalNode.parentIds,
              order: originalNode.order,
            },
          });
        }
  
        if (updates.length > 0) {
          await batchUpdateNodes(updates, timestamp);
        }
      },
  
      getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
        const treeToUpdate = draft.find((t) => t.id === activeTreeId);
        if (treeToUpdate) {
          treeToUpdate.tree = (command as MoveNodesCommand).originalState.tree as WritableDraft<TreeNode>[];
        }
      },
    };
  
    await executeCommand(command);
  }  

export async function moveNodeOrderAction(
  ctx: ActionContext,
  nodeId: string,
  direction: "up" | "down",
  contextualParentId: string | null
) {
    const { activeTree, findNodeAndContextualParent } = ctx;
    if (!activeTree || !findNodeAndContextualParent) return;

    const parentInfo = findNodeAndContextualParent(nodeId, contextualParentId, activeTree.tree);
    const parentNode = parentInfo?.parent;
    const siblings = parentNode ? parentNode.children : (activeTree.tree || []);

    if (!siblings || siblings.length < 2) return;
    
    const sortedSiblings = [...siblings].sort((a, b) => 
        getContextualOrder(a, siblings, contextualParentId) - getContextualOrder(b, siblings, contextualParentId)
    );

    const currentIndex = sortedSiblings.findIndex((s) => s.id === nodeId);
    if (currentIndex === -1) return;
    
    let moves: Parameters<typeof moveNodesAction>[1] = [];

    if (direction === "up") {
        if (currentIndex === 0) return;
        const precedingNode = sortedSiblings[currentIndex - 1];
        moves.push({
            nodeId: precedingNode.id,
            targetNodeId: nodeId,
            position: 'sibling',
            sourceContextualParentId: contextualParentId,
            targetContextualParentId: contextualParentId,
        });
    } else { // "down"
        if (currentIndex >= sortedSiblings.length - 1) return;
        const targetNode = sortedSiblings[currentIndex + 1];
        moves.push({
            nodeId: nodeId,
            targetNodeId: targetNode.id,
            position: 'sibling',
            sourceContextualParentId: contextualParentId,
            targetContextualParentId: contextualParentId
        });
    }

    if (moves.length > 0) {
        await moveNodesAction(ctx, moves);
    }
}

export async function pasteNodesAsClonesAction(
    ctx: ActionContext,
    targetNodeId: string,
    as: 'child' | 'sibling',
    nodeIdsToClone: string[],
    contextualParentId: string | null
) {
    const { activeTree, findNodeAndContextualParent, executeCommand, findNodeAndParent, activeTreeId } = ctx;
    if (!activeTree || nodeIdsToClone.length === 0) return;

    const parentInfo = findNodeAndContextualParent(targetNodeId, contextualParentId, activeTree.tree);
    const targetNode = parentInfo?.node;
    if (!targetNode) return;
    
    const newParentId = as === 'child' ? targetNodeId : parentInfo?.parent?.id || null;
    const parentNodeForSiblings = newParentId ? findNodeAndParent(newParentId, activeTree.tree)?.node : null;
    const siblings = parentNodeForSiblings ? parentNodeForSiblings.children : (activeTree.tree || []);
    
    let newOrder;
    if (as === 'child') {
        newOrder = siblings.length > 0 ? Math.max(...siblings.map(c => getContextualOrder(c, siblings, newParentId))) + 1 : 0;
    } else {
        newOrder = getContextualOrder(targetNode, siblings, newParentId) + 1;
        await reorderSiblingsForAdd(activeTree.id, newParentId, newOrder);
    }
    
    const updates = nodeIdsToClone.map((nodeId, index) => ({
        nodeId,
        newParentId,
        newOrder: newOrder + index,
        originalParentIds: findNodeAndParent(nodeId, activeTree.tree)?.node.parentIds || [],
        originalOrder: findNodeAndParent(nodeId, activeTree.tree)?.node.order || [],
    }));

    const command: PasteAsClonesCommand = {
        type: 'PASTE_AS_CLONES',
        payload: { clones: updates },
        originalState: {}, // Not needed for this specific undo logic
        execute: (draft: WritableDraft<TreeFile[]>) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId);
            if (!tree) return;

            const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
            const flatten = (nodes: WritableDraft<TreeNode>[]) => nodes.forEach(n => { allNodesMap.set(n.id, n); if(n.children) flatten(n.children); });
            flatten(tree.tree);

            updates.forEach(({ nodeId, newParentId: parentId, newOrder: order }) => {
                const nodeToUpdate = allNodesMap.get(nodeId);
                if (nodeToUpdate) {
                    nodeToUpdate.parentIds.push(parentId || 'root');
                    nodeToUpdate.order.push(order);
                }
            });

            tree.tree = reconstructTree(Array.from(allNodesMap.values()));
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
            await Promise.all(updates.map(u => addParentToNode(u.nodeId, u.newParentId, u.newOrder, timestamp)));
        },
        undo: async (timestamp?: string) => {
             await Promise.all(updates.map(u => removeParentFromNode(u.nodeId, u.newParentId!, timestamp)));
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, cmd: Command) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTreeId);
            if (!tree) return;

            const allNodesMap = new Map<string, WritableDraft<TreeNode>>();
            const flatten = (nodes: WritableDraft<TreeNode>[]) => nodes.forEach(n => { allNodesMap.set(n.id, n); if(n.children) flatten(n.children); });
            flatten(tree.tree);
            
            (cmd as PasteAsClonesCommand).payload.clones.forEach(({ nodeId, newParentId }) => {
                const node = allNodesMap.get(nodeId);
                if (node) {
                    const indexToRemove = node.parentIds.lastIndexOf(newParentId || 'root');
                    if (indexToRemove > -1) {
                        node.parentIds.splice(indexToRemove, 1);
                        node.order.splice(indexToRemove, 1);
                    }
                }
            });

            tree.tree = reconstructTree(Array.from(allNodesMap.values()));
        }
    };
    
    await executeCommand(command);
}

export async function toggleStarredForSelectedNodesAction(ctx: ActionContext) {
    const { selectedNodeIds, activeTree, executeCommand, findNodeAndParent, activeTreeId } = ctx;
    if (!selectedNodeIds || selectedNodeIds.length === 0 || !activeTree) return;
    const nodeIds = Array.from(new Set(selectedNodeIds.map(id => id.split('_')[0])));

    const firstNodeToToggle = findNodeAndParent(nodeIds[0], activeTree.tree)?.node;
    if (!firstNodeToToggle) return;
    const newStarredState = !firstNodeToToggle.isStarred;

    const updates = nodeIds.map(nodeId => ({
        id: nodeId,
        updates: { isStarred: newStarredState }
    }));
    
    const originalData = nodeIds.map(nodeId => ({
        nodeId,
        originalData: { isStarred: findNodeAndParent(nodeId, activeTree.tree)?.node.isStarred }
    }));

    const command: UpdateNodesCommand = {
        type: 'UPDATE_NODES',
        payload: updates.map(u => ({ nodeId: u.id, updates: u.updates, originalData: originalData.find(o => o.nodeId === u.id)!.originalData })),
        execute: (draft: WritableDraft<TreeFile[]>) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTree.id)?.tree;
            if (!tree) return;
            updates.forEach(({ id, updates }) => {
                const node = findNodeAndParentInDraft(id, tree)?.node;
                if (node) Object.assign(node, updates);
            });
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
            await batchUpdateNodes(updates, timestamp);
        },
        undo: async (timestamp?: string) => {
             const undoUpdates: {id: string, updates: Partial<TreeNode>}[] = [];
            originalData.forEach(({ nodeId, originalData }) => {
                undoUpdates.push({id: nodeId, updates: originalData});
            });
            await batchUpdateNodes(undoUpdates, timestamp);
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
            const tree = draft.find((t: TreeFile) => t.id === activeTree.id)?.tree;
            if (!tree) return;
            (command as UpdateNodesCommand).payload.forEach(({ nodeId, originalData }) => {
                const node = findNodeAndParentInDraft(nodeId, tree)?.node;
                if (node) {
                    Object.assign(node, originalData);
                }
            });
        },
    };
    
    await executeCommand(command);
}

    
