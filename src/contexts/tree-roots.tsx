/**
 * @fileoverview
 * This file is the single source of truth for all tree-related state management.
 * It defines the context, the provider component, the main state hook (`useTreeRoots`),
 * and the consumer hook (`useTreeContext`).
 */
"use client";

import React, { useState, useEffect, useCallback, useMemo, Dispatch, SetStateAction, useRef } from "react";
import { useRouter, usePathname } from 'next/navigation';
import { useImmer } from "use-immer";
import { produce, WritableDraft } from "immer";
import { useToast } from '@/hooks/use-toast';
import { 
    TreeFile,
    User,
    Field,
    ExampleInfo,
    AttachmentInfo,
    GitCommit,
    StorageInfo,
    PurgeResult,
    TreeNode,
    Template,
    AddNodesCommand,
    DeleteNodesCommand,
    MoveNodesCommand,
    UpdateNodesCommand,
    UpdateTreeFileCommand,
    ExpandCollapseCommand,
    ClipboardState,
    ReorderNodesCommand,
    ActionContext,
    PasteAsClonesCommand,
    Command,
    UseTreeRootsResult,
    TreeContextType,
} from '@/lib/types';
import { generateJsonForExport, getContextualOrder, generateClientSideId } from '@/lib/utils';
import { createNodesArchive } from "@/lib/archive";
import { HtmlExportView } from "@/components/tree/html-export-view";
import { 
    loadAllTreeFiles,
    createTreeFile as createTreeFileInDb,
    loadTreeFile,
    saveTreeFile,
    deleteTreeFile as deleteTreeFileFromDb,
    listExamples as listExamplesFromDataService,
    loadExampleFromFile,
    shareTreeWithUser,
    revokeShareFromUser,
    setTreePublicStatus as setTreePublicStatusInDb,
    createRepo,
    getRepoCommits,
    getLatestCommitSha,
    getTreeFromGit,
    saveAttachment as uploadAttachmentToServer,
    fetchFileAsBuffer,
    batchCreateNodes,
    batchDeleteNodes,
    updateTreeOrder as updateTreeOrderInDb,
    reorderSiblingsForAdd,
    resequenceSiblings,
    addParentToNode,
    removeParentFromNode,
    batchUpdateNodes,
    findNodeById,
} from '@/lib/data-service';
import { getStorageInfo, purgeUnusedFiles } from '@/lib/storage-service';
import { readArchive } from "@/lib/archive";
import { useAuthContext } from "./auth-context";
import path from 'path';
import { useDebouncedCallback } from "use-debounce";
import { useGitSync } from "@/hooks/useGitSync";
import { arrayMove } from "@dnd-kit/sortable";
import {
    addNodesAction,
    addRootNodeAction,
    addChildNodeAction,
    addSiblingNodeAction,
    updateNodeAction,
    updateNodeNamesForTemplateAction,
    changeNodeTemplateAction,
    changeMultipleNodesTemplateAction,
    deleteNodeAction,
    deleteNodesAction,
    copyNodesAction,
    moveNodesAction,
    moveNodeOrderAction,
    pasteNodesAsClonesAction,
    toggleStarredForSelectedNodesAction,
} from '@/lib/node-actions';
import ReactDOMServer from "react-dom/server";
import { TreeContext } from './tree-context';


// Helper to create a default tree structure
async function createDefaultTreeFile(title: string, userId: string, order: number): Promise<{
  treeFile: Omit<TreeFile, 'tree' | 'id'>;
  initialNodes: Omit<TreeNode, 'id' | 'children' | '_id'>[];
}> {
  let defaultTemplates: Template[] = [];
  try {
    const templateNames = ['folder.json', 'note.json'];
    const templatePromises = templateNames.map(name =>
      fetch(`/templates/${name}`).then(res => res.json())
    );
    defaultTemplates = await Promise.all(templatePromises);
  } catch (error) {
    console.warn("Could not load default templates:", error);
    // Proceed without default templates if they fail to load
  }

  return {
    treeFile: {
      title,
      userId,
      templates: defaultTemplates,
      expandedNodeIds: [],
      order,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    initialNodes: [],
  };
}


interface UseTreeRootsProps {
    initialTree?: TreeFile;
}

export function useTreeRoots({ initialTree }: UseTreeRootsProps = {}): UseTreeRootsResult {
  const { currentUser, setLastActiveTreeId: setLastActiveTreeIdForUser } = useAuthContext();
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isTreeDataLoading, setIsTreeDataLoading] = useState(isDataLoaded === false);
  const router = useRouter();
  const pathname = usePathname();
  const [allTrees, setAllTrees] = useImmer<TreeFile[]>(initialTree ? [JSON.parse(JSON.stringify(initialTree))] : []);
  
  const [commandHistory, setCommandHistory] = useImmer<Command[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [activeTreeId, _setActiveTreeId] = useState<string | null>(initialTree ? initialTree.id : null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(isDataLoaded === false);

  const [clipboard, setClipboard] = useState<ClipboardState>({ nodes: null, operation: null });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState<string | null>(null);

  const { toast } = useToast();
  
  const performAction = useCallback((updater: (draft: WritableDraft<TreeFile[]>) => TreeFile[] | void, isUndoable: boolean = true) => {
    setAllTrees(updater as (draft: WritableDraft<TreeFile[]>) => WritableDraft<TreeFile[]> | void);
    if (isUndoable) {
        setIsDirty(true);
    }
  }, [setAllTrees]);

  const executeCommand = useCallback(async (command: Command, isUndoable: boolean = true) => {
    if (!activeTreeId) return;

    const newTimestamp = new Date().toISOString();
    
    // Create the "after" state in memory, applying the state change and the new timestamp together
    const finalTreeSnapshot = produce(allTrees, draft => {
        const treeToUpdate = draft.find(t => t.id === activeTreeId);
        if (treeToUpdate) {
            command.execute(draft); // Apply command's state change logic
            treeToUpdate.updatedAt = newTimestamp; // Update timestamp in the same mutation
        }
    });

    const finalTreeFile = finalTreeSnapshot.find(t => t.id === activeTreeId);

    // Call the post-execution database function with the updated timestamp
    if (command.post && finalTreeFile) {
        await command.post(finalTreeFile, newTimestamp);
    }

    // Update the UI state with the already-computed final snapshot
    setAllTrees(() => finalTreeSnapshot as WritableDraft<TreeFile[]>);
    
    if (isUndoable) {
        const newHistory = commandHistory.slice(0, historyIndex + 1);
        newHistory.push(command);
        if (newHistory.length > 30) {
            newHistory.shift();
        }
        setCommandHistory(() => newHistory);
        setHistoryIndex(newHistory.length - 1);
    }

}, [allTrees, activeTreeId, commandHistory, historyIndex, setAllTrees, setCommandHistory]);
  
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < commandHistory.length - 1;

  const getActionDescription = (command?: Command): string | null => {
    if (!command) return null;
    return command.type.replace(/_/g, ' ').toLowerCase();
  }

  const undoActionDescription = useMemo(() => getActionDescription(commandHistory[historyIndex]), [commandHistory, historyIndex]);
  const redoActionDescription = useMemo(() => getActionDescription(commandHistory[historyIndex + 1]), [commandHistory, historyIndex]);

  // Client-side security filter. Only show trees the user has access to.
  const visibleTrees = useMemo(() => {
    if (!currentUser) return [];
    return allTrees.filter(tree => 
        tree.userId === currentUser.id || 
        (tree.sharedWith && tree.sharedWith.includes(currentUser.id))
    );
  }, [allTrees, currentUser]);

  const activeTree = visibleTrees.find((t) => t.id === activeTreeId);

  const reloadAllTrees = useCallback(async () => {
    if (!currentUser) return;
    console.log("INFO: Reloading all trees from server...");
    const loadedTrees = await loadAllTreeFiles(currentUser.id);
    loadedTrees.sort((a,b) => (a.order || 0) - (b.order || 0));
    setAllTrees(() => loadedTrees);
  }, [currentUser, setAllTrees]);
  
    const setActiveTreeId = useCallback((id: string | null) => {
        _setActiveTreeId(id);
        setCommandHistory(() => []);
        setHistoryIndex(-1);
        setLastActiveTreeIdForUser(id);
    }, [setCommandHistory, setHistoryIndex, setLastActiveTreeIdForUser]);

  const reloadActiveTree = useCallback(
    async (treeIdToLoad?: string) => {
      const idToLoad = treeIdToLoad || activeTreeId;
      if (!idToLoad) return;
      
      const reloadedTree = await loadTreeFile(idToLoad);
      if (reloadedTree) {
        setAllTrees((draft: WritableDraft<TreeFile[]>) => {
            const index = draft.findIndex((t: TreeFile) => t.id === idToLoad);
            if (index > -1) {
                // Preserve expanded state while updating everything else
                const oldExpanded = draft[index].expandedNodeIds;
                draft[index] = { ...reloadedTree, expandedNodeIds: oldExpanded };
            }
        });
        toast({ title: "Tree Reloaded", description: "The latest version of the tree has been loaded." });
        console.log('INFO: Reloaded tree due to external change.')
      } else {
        toast({ variant: "destructive", title: "Reload Failed", description: `Could not reload the tree.` });
        console.error(`ERROR: Failed to reload tree with ID ${idToLoad}.`);
      }
    },
    [activeTreeId, setAllTrees, toast]
  );
  
  const createNewTree = useCallback(
    async (title: string, user?: User): Promise<string | null> => {
      const userToCreateFor = user || currentUser;
      if (!userToCreateFor) return null;
      const newOrder = allTrees.length;
      const { treeFile, initialNodes } = await createDefaultTreeFile(title, userToCreateFor.id, newOrder);

      const createdTree = await createTreeFileInDb(
        treeFile,
        initialNodes
      );

      const fullCreatedTree = await loadTreeFile(createdTree.id);
      if (fullCreatedTree) {
        setAllTrees((draft) => {draft.push(fullCreatedTree)});
        setActiveTreeId(fullCreatedTree.id);
        return fullCreatedTree.id;
      }
      return null;
    },
    [currentUser, allTrees, setAllTrees, setActiveTreeId]
  );
  
  const importTreeFromJson = useCallback(
    async (jsonData: any, user?: User, rewriteAttachmentPaths: boolean = false): Promise<string | null> => {
      const userToImportFor = user || currentUser;
      if (!userToImportFor) {
        throw new Error("You must be logged in to import a tree.");
      }

      const nodes = jsonData.nodes || jsonData.tree;
      if (!nodes) {
        throw new Error("JSON file must contain a 'nodes' or 'tree' property.");
      }

      const idMap = new Map<string, string>();
      const templates = jsonData.templates || [];
      const newUserId = userToImportFor.id;

      // First pass: create new IDs and map old to new
      const nodeDataToCreate: Partial<TreeNode>[] = nodes.map((node: TreeNode) => {
        const newId = generateClientSideId();
        idMap.set(node.id, newId);
        return {
          ...node,
          _id: newId,
          id: newId,
          children: [], // Children are handled via parentIds
        };
      });

      // Regex to find internal links
      const linkRegex = /node:\/\/([\w.:-]+)/g;

      // Second pass: remap parentIds and internal links
      nodeDataToCreate.forEach((node) => {
        // Remap parentIds
        if (node.parentIds) {
          node.parentIds = node.parentIds.map((pid: string) => idMap.get(pid)!).filter(Boolean);
        }

        // Remap fields in data
        if (node.data) {
          const template = templates.find((t: Template) => t.id === node.templateId);
          if (template) {
            template.fields.forEach((field: Field) => {
              if (node.data![field.id]) {
                const processValue = (value: string): string => {
                    return value.replace(linkRegex, (match: string, oldId: string) => {
                        return idMap.get(oldId) ? `node://${idMap.get(oldId)}` : match;
                    });
                };
                
                if ((field.type === "link" || field.type === "textarea") && typeof node.data![field.id] === 'string') {
                    node.data![field.id] = processValue(node.data![field.id]);
                }
                // Only rewrite attachment paths if explicitly told to (i.e., for ZIP imports)
                else if (rewriteAttachmentPaths && (field.type === "picture" || field.type === "attachment")) {
                  const value = node.data![field.id];
                  const attachmentRegex = /\/attachments\/([^/]+)\/(.+)/;

                  const rewritePath = (item: string | AttachmentInfo) => {
                    const serverPath = typeof item === "string" ? item : item.path;
                    const match = serverPath.match(attachmentRegex);
                    if (!match) return item; // Not a recognized attachment path

                    const newPath = `/attachments/${newUserId}/${match[2]}`;
                    return typeof item === "string" ? newPath : { ...item, path: newPath };
                  };

                  if (Array.isArray(value)) {
                    node.data![field.id] = value.map(rewritePath);
                  } else if (typeof value === "string" || (typeof value === "object" && (value as any).path)) {
                    node.data![field.id] = rewritePath(value as any);
                  }
                }
              }
            });
          }
        }
      });

      const { id, ...restOfTreeFile } = jsonData;
      const newTreeData = {
        ...restOfTreeFile,
        title: jsonData.title || "Imported Tree",
        userId: userToImportFor.id,
        templates: jsonData.templates || [],
        expandedNodeIds: [],
        order: allTrees.length, // Add to the end by default
      };

      const createdTree = await createTreeFileInDb(newTreeData, []);
      const treeId = createdTree.id;

      const nodesForDb = nodeDataToCreate.map((n) => ({ ...n, treeId, userId: userToImportFor.id }));

      if (nodesForDb.length > 0) {
        await batchCreateNodes(nodesForDb);
      }

      const finalTree = await loadTreeFile(treeId);
      if (finalTree) {
        setAllTrees((draft) => {draft.push(finalTree)});
        setActiveTreeId(treeId);
        return finalTree.id;
      }
      return null;
    },
    [currentUser, allTrees, setAllTrees, setActiveTreeId]
  );
  
  const deleteTree = async (id: string) => {
    if (!currentUser) return;
    const treeToDelete = allTrees.find((t: TreeFile) => t.id === id);
    if (!treeToDelete) return;

    try {
      await deleteTreeFileFromDb(id);

      setAllTrees((draft) => {
        const index = draft.findIndex((t: TreeFile) => t.id === id);
        if (index > -1) draft.splice(index, 1);
      });

      if (activeTreeId === id) {
        const newActiveId = allTrees.length > 1 ? allTrees.find(t => t.id !== id)?.id || null : null;
        setActiveTreeId(newActiveId);
        if (newActiveId === null) router.push("/roots");
      }

      toast({ title: "Tree Deleted", description: `"${treeToDelete.title}" was permanently deleted.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: `Failed to delete the tree.` });
      await reloadAllTrees();
    }
  };

  const getNodeInstancePaths = useCallback(
    (nodeId: string): string[] => {
      if (!activeTree) return [];
      const paths: string[] = [];
      const findPaths = (nodes: TreeNode[], currentPath: string[]) => {
        for (const node of nodes) {
          const newPath = [...currentPath, node.name];
          if (node.id === nodeId) paths.push(newPath.join(" > "));
          if (node.children) findPaths(node.children, newPath);
        }
      };
      findPaths(activeTree.tree, []);
      return paths;
    },
    [activeTree]
  );
  
  const {
    conflictState,
    setConflictState,
    linkTreeToRepo,
    fetchRepoHistory,
    syncFromRepo,
    restoreToCommit,
    resolveConflict,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    commitToRepo: commitToRepoViaSync,
  } = useGitSync({
    currentUser,
    allTrees,
    performAction,
    importTreeFromJson,
    deleteTree,
    reloadActiveTree,
    reloadAllTrees,
    setActiveTreeId,
    replaceTree: async (oldTreeId: string, newTreeId: string, metaToKeep: Partial<TreeFile>) => {
        await deleteTreeFileFromDb(oldTreeId);
        const { tree, ...rest } = metaToKeep as any;
        await saveTreeFile({ ...rest, id: newTreeId });
    },
  });

  const undoLastAction = useCallback(async () => {
    if (!canUndo) return;
    const commandToUndo = commandHistory[historyIndex];
    if (!commandToUndo) return;
  
    const newTimestamp = new Date().toISOString();
  
    const undoSnapshot = produce(allTrees, draft => {
        if (commandToUndo.getUndoState) {
            commandToUndo.getUndoState(draft, commandToUndo);
        }
        const treeToUpdate = draft.find(t => t.id === activeTreeId);
        if (treeToUpdate) {
            treeToUpdate.updatedAt = newTimestamp;
        }
    });

    await commandToUndo.undo(newTimestamp);
    setAllTrees(() => undoSnapshot);
    setHistoryIndex((prev) => prev - 1);
  
    toast({
      title: "Undo",
      description: `Reversed action: ${getActionDescription(commandToUndo)}`,
    });
  
  }, [canUndo, commandHistory, historyIndex, setAllTrees, setHistoryIndex, toast, allTrees, activeTreeId]);
  
  const redoLastAction = useCallback(async () => {
    const newIndex = historyIndex + 1;
    if (!canRedo || newIndex >= commandHistory.length) return;

    const commandToRedo = commandHistory[newIndex];
    if (!commandToRedo) return;
    
    const newTimestamp = new Date().toISOString();

    const afterState = produce(allTrees, draft => {
        const treeToUpdate = draft.find(t => t.id === activeTreeId);
        if (treeToUpdate) {
            commandToRedo.execute(draft);
            treeToUpdate.updatedAt = newTimestamp;
        }
    });
    
    const finalTreeFile = afterState.find(t => t.id === activeTreeId);

    setAllTrees(() => afterState);
    setHistoryIndex(newIndex);
    
    toast({
        title: 'Redo',
        description: `Re-applied action: ${getActionDescription(commandToRedo)}`,
    });
    
    if (commandToRedo.redo) {
        await commandToRedo.redo(finalTreeFile, newTimestamp);
    } else if (commandToRedo.post && finalTreeFile) {
        await commandToRedo.post(finalTreeFile, newTimestamp);
    }
}, [canRedo, commandHistory, historyIndex, allTrees, activeTreeId, setAllTrees, setHistoryIndex, toast]);


  const loadUserSpecificData = useCallback(
    async (user: User) => {
      setIsTreeDataLoading(true);
      try {
        let loadedTrees = await loadAllTreeFiles(user.id);
        if (loadedTrees.length === 0) {
          const welcomeGuideData = await loadExampleFromFile("welcome-guide.json");
          if (welcomeGuideData) {
            await importTreeFromJson(welcomeGuideData, user, true);
            loadedTrees = await loadAllTreeFiles(user.id);
          } else {
            await createNewTree("My First Tree", user);
            loadedTrees = await loadAllTreeFiles(user.id);
          }
        }
        
        loadedTrees.sort((a,b) => (a.order || 0) - (b.order || 0));

        setAllTrees(() => loadedTrees);
        const lastActiveTreeId = user.lastActiveTreeId;
        if (lastActiveTreeId && loadedTrees.some((t) => t.id === lastActiveTreeId)) {
          setActiveTreeId(lastActiveTreeId);
        } else {
          setActiveTreeId(loadedTrees[0]?.id || null);
        }

      } catch (error) {
        console.error("ERROR: Failed to initialize auth:", error);
      } finally {
        setIsDataLoaded(true);
        setIsTreeDataLoading(false);
      }
    },
    [createNewTree, importTreeFromJson, setAllTrees, setActiveTreeId]
  );

  const activeTreeRef = useRef<TreeFile | undefined>();
  useEffect(() => {
    activeTreeRef.current = activeTree;
  }, [activeTree]);

  useEffect(() => {
      if (initialTree || !currentUser) return;
  
      const intervalId = setInterval(async () => {
        if (!activeTreeRef.current) return;
        try {
          const response = await fetch(`/api/tree-status/${activeTreeRef.current.id}`);
          if (response.ok) {
            const { updatedAt: serverUpdatedAt } = await response.json();
            
            if (!activeTreeRef.current) return;
            const localUpdatedAt = activeTreeRef.current.updatedAt;
  
            if (serverUpdatedAt && localUpdatedAt) {
              const serverTime = new Date(serverUpdatedAt).getTime();
              const localTime = new Date(localUpdatedAt).getTime();
              
              if (serverTime > localTime + 1000) {
                  await reloadActiveTree();
              }
            }
          }
        } catch (error) {
          console.warn("Polling for tree status failed:", error);
        }
      }, 5000); 
  
      return () => clearInterval(intervalId);
    }, [initialTree, currentUser, reloadActiveTree]);


  useEffect(() => {
    if (initialTree) {
      setIsDataLoaded(true);
      setIsTreeDataLoading(false);
      return;
    }
    if (currentUser && !isDataLoaded) {
      loadUserSpecificData(currentUser);
    } else if (!currentUser && isDataLoaded) {
      setAllTrees(() => []);
      setActiveTreeId(null);
      setCommandHistory(() => []);
      setHistoryIndex(-1);
      setIsDataLoaded(false);
      setIsTreeDataLoading(true);
    }
  }, [currentUser, isDataLoaded, loadUserSpecificData, setAllTrees, setCommandHistory, setHistoryIndex, initialTree, setActiveTreeId]);
  
  const commitToRepo = useCallback(
    (treeId: string, message: string, token: string, force: boolean = false, treeFileToCommit?: TreeFile): Promise<{ success: boolean; error?: string, commitSha?: string }> => {
        // Clear history on commit to prevent complex state issues
        setCommandHistory(() => []);
        setHistoryIndex(-1);
        setIsDirty(false);
        return commitToRepoViaSync(treeId, message, token, force, treeFileToCommit);
    },
    [commitToRepoViaSync, setCommandHistory, setHistoryIndex]
  );

  const debouncedSave = useDebouncedCallback((treeToSave: TreeFile) => {
    if (currentUser && !isSaving) {
      const newTimestamp = new Date().toISOString();
      const updatedTree = { ...treeToSave, updatedAt: newTimestamp };

      // Optimistically update local state with the new timestamp immediately
      setAllTrees((draft) => {
        const treeIndex = draft.findIndex((t: TreeFile) => t.id === treeToSave.id);
        if (treeIndex > -1) {
          draft[treeIndex].updatedAt = newTimestamp;
        }
      });
      setIsDirty(false); // Mark as clean now that we have the timestamp
      setIsSaving(true);
      
      const { tree, ...metaData } = updatedTree;
  
      saveTreeFile(metaData, newTimestamp).finally(() => {
        setIsSaving(false);
        console.log(`INFO: Debounced save for tree '${treeToSave.title}' executed successfully.`);
      });
    }
  }, 1000);

  useEffect(() => {
    if (isDirty && activeTree && !isSaving) {
      debouncedSave(activeTree);
    }
  }, [isDirty, activeTree, debouncedSave, isSaving]);
  
  const findNodeAndParent = useCallback((nodeId: string, nodes?: TreeNode[]): { node: TreeNode; parent: TreeNode | null } | null => {
    const searchNodes = nodes || activeTree?.tree;
    if (!searchNodes) return null;

    for (const node of searchNodes) {
        if (node.id === nodeId) {
            return { node, parent: null };
        }
        if (node.children) {
            const found = findNodeAndParent(nodeId, node.children);
            if (found) {
                return { ...found, parent: found.parent || node };
            }
        }
    }
    return null;
  }, [activeTree?.tree]);
  
  const findNodeAndContextualParent = useCallback(
    (nodeId: string | null, contextualParentId: string | null, nodes?: TreeNode[]): { node: TreeNode, parent: TreeNode | null } | null => {
      const searchNodes = nodes || activeTree?.tree;
      if (!searchNodes || !nodeId) return null;
      
      const nodeInfo = findNodeAndParent(nodeId, searchNodes);
      if (!nodeInfo) return null;

      const contextualParent = contextualParentId ? findNodeAndParent(contextualParentId, searchNodes)?.node ?? null : null;
      return { node: nodeInfo.node, parent: contextualParent };
    },
    [activeTree, findNodeAndParent]
  );
  
  const isCloneOrDescendant = useCallback((nodeId: string, nodes?: TreeNode[]): boolean => {
      const nodeInfo = findNodeAndParent(nodeId, nodes);
      if (!nodeInfo) return false;
      const { node, parent } = nodeInfo;
      if ((node.parentIds || []).length > 1) return true;
      if (parent) return isCloneOrDescendant(parent.id, nodes);
      return false;
  }, [findNodeAndParent]);

  const getSiblingOrderRange = (siblings: TreeNode[], parentId: string | null): { minOrder: number; maxOrder: number } => {
    if (!siblings || siblings.length === 0) return { minOrder: 0, maxOrder: 0 };
    const orders = siblings.map(s => getContextualOrder(s, siblings, parentId));
    return {
        minOrder: Math.min(...orders),
        maxOrder: Math.max(...orders),
    };
  };

  const updateTreeOrder = useCallback(async (updates: { id: string; order: number }[]) => {
    if (!currentUser) return;
    
    performAction((draft: WritableDraft<TreeFile[]>) => {
        updates.forEach(({ id, order }) => {
            const tree = draft.find((t) => t.id === id);
            if (tree) {
                tree.order = order;
            }
        });
        draft.sort((a, b) => (a.order || 0) - (b.order || 0));
    }, false);

    try {
        await updateTreeOrderInDb(updates);
    } catch (error) {
        console.error("Failed to save tree order:", error);
        toast({
            variant: "destructive",
            title: "Error",
            description: "Could not save the new tree order.",
        });
        await reloadAllTrees();
    }
  }, [currentUser, performAction, reloadAllTrees, toast]);

  const setTreeTitle = (treeId: string, title: string) => {
    const currentTree = allTrees.find(t=>t.id === treeId);
    if (!currentTree) return;
    const originalTitle = currentTree.title;

    const command: UpdateTreeFileCommand = {
        type: 'UPDATE_TREE_FILE',
        payload: { treeId, updates: { title } },
        originalState: { title: originalTitle },
        execute: (draft: WritableDraft<TreeFile[]>) => { 
            const t = draft.find((t: TreeFile) => t.id === treeId); 
            if (t) t.title = title; 
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
            await saveTreeFile({ id: treeId, title }, timestamp);
        },
        undo: async (timestamp?: string) => {
            await saveTreeFile({ id: treeId, title: originalTitle }, timestamp);
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, command: Command) => {
          const t = draft.find(t => t.id === treeId);
          if (t && (command as UpdateTreeFileCommand).originalState.title) {
            t.title = (command as UpdateTreeFileCommand).originalState.title!;
          }
        }
    };
    executeCommand(command);
  };
  
  const setTemplates = useCallback((updater: Template[] | ((current: Template[]) => Template[])) => {
    if (!activeTreeId) return;
    const currentTree = allTrees.find(t => t.id === activeTreeId);
    if (!currentTree) return;

    const originalTemplates = currentTree.templates;
    const newTemplates = typeof updater === 'function' ? updater(originalTemplates) : updater;

    const command: UpdateTreeFileCommand = {
        type: 'UPDATE_TREE_FILE',
        payload: { treeId: activeTreeId, updates: { templates: newTemplates } },
        originalState: { templates: originalTemplates },
        execute: (draft: WritableDraft<TreeFile[]>) => {
            const tree = draft.find(t => t.id === activeTreeId);
            if (tree) {
                // Apply the updater to the draft state correctly
                tree.templates = typeof updater === 'function' 
                    ? produce(tree.templates, updater as (draft: WritableDraft<Template[]>) => void) 
                    : updater;
            }
        },
        post: async (finalTreeFile?: TreeFile, timestamp?: string) => {
            if (finalTreeFile && activeTreeId) {
                await saveTreeFile({ id: activeTreeId, templates: finalTreeFile.templates }, timestamp);
            }
        },
        undo: async (timestamp?: string) => {
            if (activeTreeId) {
                await saveTreeFile({ id: activeTreeId, templates: originalTemplates }, timestamp);
            }
        },
        getUndoState: (draft: WritableDraft<TreeFile[]>, cmd: Command) => {
            if (!activeTreeId) return;
            const tree = draft.find(t => t.id === activeTreeId);
            const originalState = (cmd as UpdateTreeFileCommand).originalState;
            if (tree && originalState.templates) {
                tree.templates = originalState.templates;
            }
        },
    };
    executeCommand(command, true);
  }, [activeTreeId, allTrees, executeCommand]);
  
  const importTemplates = useCallback((newTemplates: Template[]) => {
    setTemplates((currentTemplates: Template[]) => {
      const existingIds = new Set(currentTemplates.map((t) => t.id));
      let importedCount = 0;
      const templatesToAdd = [];
      for (const t of newTemplates) {
        if (!existingIds.has(t.id)) {
          templatesToAdd.push(t);
          existingIds.add(t.id);
          importedCount++;
        }
      }
      console.log(`INFO: Imported ${importedCount} new templates.`);
      return [...currentTemplates, ...templatesToAdd];
    });
  }, [setTemplates]);

  const setExpandedNodeIds = useCallback((updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable = true) => {
      const newExpandedIds = produce(activeTree?.expandedNodeIds || [], updater as any);
      
      performAction((draft) => {
          if (!activeTreeId) return;
          const tree = draft.find(t => t.id === activeTreeId);
          if (tree) {
              tree.expandedNodeIds = newExpandedIds;
          }
      }, false); // Expand/collapse is not undoable for simplicity
      
      // Save to DB immediately, but without blocking the UI
      if (activeTree) {
        debouncedSave({ ...activeTree, expandedNodeIds: newExpandedIds });
      }

  }, [activeTreeId, performAction, activeTree, debouncedSave]);

  const expandAllFromNode = useCallback((nodesToExpand: { nodeId: string, parentId: string | null }[]) => {
    if (!activeTree || nodesToExpand.length === 0) return;
    
    const allIdsToAdd = new Set<string>();

    const traverse = (nodes: TreeNode[], parentId: string | null) => {
        for (const node of nodes) {
            allIdsToAdd.add(`${node.id}_${parentId || "root"}`);
            // Also add paths for other parents if it's a clone
            (node.parentIds || []).forEach(pId => {
                if (pId !== (parentId || 'root')) {
                    allIdsToAdd.add(`${node.id}_${pId}`);
                }
            });
            if (node.children) {
                traverse(node.children, node.id);
            }
        }
    };
    
    for (const { nodeId } of nodesToExpand) {
        const result = findNodeAndParent(nodeId, activeTree.tree);
        if (!result) continue;
        const { node } = result;

        traverse([node], nodeId);
    }


    if (allIdsToAdd.size > 0) {
        setExpandedNodeIds((currentIds: WritableDraft<string[]>) => {
            const idSet = new Set(currentIds);
            allIdsToAdd.forEach(id => idSet.add(id));
            return Array.from(idSet);
        }, true);
    }
  }, [activeTree, findNodeAndParent, setExpandedNodeIds]);

  const collapseAllFromNode = useCallback((nodesToCollapse: { nodeId: string, parentId: string | null }[]) => {
    if (!activeTree || nodesToCollapse.length === 0) return;
    
    const allIdsToRemove = new Set<string>();

    const traverse = (nodes: TreeNode[], parentId: string | null) => {
      for (const node of nodes) {
          allIdsToRemove.add(`${node.id}_${parentId || "root"}`);
           // Also remove paths for other parents if it's a clone
          (node.parentIds || []).forEach(pId => {
              if (pId !== (parentId || 'root')) {
                  allIdsToRemove.add(`${node.id}_${pId}`);
              }
          });
          if (node.children) {
              traverse(node.children, node.id);
          }
      }
    };

    for (const { nodeId, parentId } of nodesToCollapse) {
        const result = findNodeAndParent(nodeId, activeTree.tree);
        if (!result) continue;
        const { node } = result;

        traverse([node], parentId);
    }
    
    if (allIdsToRemove.size > 0) {
      setExpandedNodeIds((currentIds: WritableDraft<string[]>) => {
        // Mutate draft directly for performance with Immer
        for (let i = currentIds.length - 1; i >= 0; i--) {
          if (allIdsToRemove.has(currentIds[i])) {
            currentIds.splice(i, 1);
          }
        }
      }, true);
    }
  }, [activeTree, findNodeAndParent, setExpandedNodeIds]);

  const actionContext: ActionContext = useMemo(() => ({
    activeTree,
    currentUser,
    activeTreeId,
    executeCommand,
    findNodeAndParent,
    allTrees: visibleTrees,
    findNodeAndContextualParent,
    reloadActiveTree,
    isCloneOrDescendant,
    clipboard,
    toast,
    getSiblingOrderRange,
    selectedNodeIds,
  }), [activeTree, currentUser, activeTreeId, executeCommand, findNodeAndParent, visibleTrees, findNodeAndContextualParent, reloadActiveTree, isCloneOrDescendant, clipboard, toast, getSiblingOrderRange, selectedNodeIds]);


  const addChildNode = useCallback(async (
    parentNodeId: string,
    childNodeData: Partial<Omit<TreeNode, "id" | "children">>,
    contextualParentId: string | null
  ) => {
    await addChildNodeAction(actionContext, parentNodeId, childNodeData, contextualParentId);
  }, [actionContext]);

  const addSiblingNode = useCallback(async (
    siblingNodeId: string, 
    nodeToAddData: Partial<Omit<TreeNode, 'id' | 'children'>>, 
    contextualParentId: string | null
  ) => {
    await addSiblingNodeAction(actionContext, siblingNodeId, nodeToAddData, contextualParentId);
  }, [actionContext]);
  
  const updateNode = useCallback(async (nodeId: string, newNodeData: Partial<Omit<TreeNode, 'id' | 'children'>>) => {
    await updateNodeAction(actionContext, nodeId, newNodeData);
  }, [actionContext]);

  const updateNodeNamesForTemplate = useCallback(async (template: Template) => {
    await updateNodeNamesForTemplateAction(actionContext, template);
  }, [actionContext]);

  const changeNodeTemplate = useCallback(async (nodeId: string, newTemplateId: string) => {
    await changeNodeTemplateAction(actionContext, nodeId, newTemplateId);
  }, [actionContext]);

  const changeMultipleNodesTemplate = useCallback(async (instanceIds: string[], newTemplateId: string) => {
    await changeMultipleNodesTemplateAction(actionContext, instanceIds, newTemplateId);
  }, [actionContext]);

  const deleteNode = useCallback(async (nodeId: string, contextualParentId: string | null) => {
    await deleteNodeAction(actionContext, nodeId, contextualParentId);
  }, [actionContext]);

  const deleteNodes = useCallback(async (instanceIds: string[]) => {
    await deleteNodesAction(actionContext, instanceIds);
  }, [actionContext]);

  const pasteNodes = useCallback(async (
    targetNodeId: string,
    position: 'child' | 'sibling',
    contextualParentId: string | null,
    nodes?: TreeNode[]
  ) => {
      await copyNodesAction(actionContext, targetNodeId, position, contextualParentId, nodes);
  }, [actionContext]);

  const moveNodes = useCallback(async (moves: { nodeId: string; targetNodeId: string; position: 'child' | 'sibling' | 'child-bottom'; sourceContextualParentId: string | null; targetContextualParentId: string | null;}[]) => {
    await moveNodesAction(actionContext, moves);
  }, [actionContext]);

  const moveNodeOrder = useCallback(async (nodeId: string, direction: "up" | "down", contextualParentId: string | null) => {
    await moveNodeOrderAction(actionContext, nodeId, direction, contextualParentId);
  }, [actionContext]);
  
  const pasteNodesAsClones = useCallback(async (targetNodeId: string, as: 'child' | 'sibling', nodeIdsToClone: string[], contextualParentId: string | null) => {
    await pasteNodesAsClonesAction(actionContext, targetNodeId, as, nodeIdsToClone, contextualParentId);
  }, [actionContext]);
  
  const toggleStarredForSelectedNodes = useCallback(async () => {
    await toggleStarredForSelectedNodesAction(actionContext);
  }, [actionContext]);
  
  const addRootNode = async (nodeData: Partial<Omit<TreeNode, "id" | "children">>) => {
    await addRootNodeAction(actionContext, nodeData as Omit<TreeNode, 'id' | 'children' | 'treeId' | 'userId' | 'parentIds' | 'order'>);
  }

  const getTemplateById = useCallback(
    (id: string): Template | undefined => {
      return activeTree?.templates?.find((t) => t.id === id);
    },
    [activeTree]
  );
  
  const exportNodesAsJson = (nodesToExport: TreeNode[], baseName: string) => {
    if (!activeTree || nodesToExport.length === 0) return;
    const dataToExport = generateJsonForExport(baseName, nodesToExport, activeTree.templates);
    const data = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName.replace(/\s/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportNodesAsArchive = async (nodes: TreeNode[], baseName: string) => {
    if (!activeTree) return;
    await createNodesArchive(nodes, activeTree.tree, activeTree.templates, baseName, (relativePath: string) =>
      fetchFileAsBuffer(activeTree!.userId, relativePath)
    );
  };

  const exportNodesAsHtml = async (elementId: string, nodes: TreeNode[], title: string) => {
    if (!activeTree) return;

    toast({ title: "Generating HTML...", description: "This may take a moment." });

    const cssResponse = await fetch("/globals.css");
    const cssText = await cssResponse.text();

    const imagePromises: Promise<{ path: string; dataUri: string }>[] = [];
    const attachmentsMap = new Map<string, string>();

    const traverseTree = (nodes: TreeNode[], cb: (node: TreeNode) => void) => {
      for (const node of nodes) {
        cb(node);
        if (node.children && node.children.length > 0) {
          traverseTree(node.children, cb);
        }
      }
    };

    traverseTree(nodes, (node) => {
      const template = getTemplateById(node.templateId);
      if (!template) return;
      for (const field of template.fields) {
        const value = (node.data || {})[field.id];
        if (!value) continue;

        const processItem = (fileOrPath: string | AttachmentInfo) => {
          const serverPath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
          if (typeof serverPath === 'string' && serverPath.startsWith('/attachments/')) {
            const originalFileName = typeof fileOrPath === "string" ? path.basename(serverPath) : fileOrPath.name;
            attachmentsMap.set(serverPath, originalFileName);
            const promise = fetch(serverPath)
              .then((res) => res.blob())
              .then(blobToDataURI)
              .then((dataUri) => ({ path: serverPath, dataUri }));
            imagePromises.push(promise);
          }
        };

        if (field.type === "picture" || field.type === "attachment") {
          (Array.isArray(value) ? value : [value]).forEach(processItem);
        }
      }
    });

    const imageResults = await Promise.all(imagePromises);
    const imageMap = new Map(imageResults.map((r) => [r.path, r.dataUri]));

    const staticHtml = ReactDOMServer.renderToStaticMarkup(
      <HtmlExportView
        nodes={nodes}
        title={title}
        getTemplateById={getTemplateById}
        imageMap={imageMap}
        attachmentsMap={attachmentsMap}
        currentUser={currentUser}
      />
    );

    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${title}</title>
          <style>${cssText}</style>
          <style>
            body { padding: 2rem; }
            .tree-node-card { border: 1px solid #e5e7eb; border-radius: 0.5rem; margin-bottom: 8px; }
            .tree-node-header { padding: 8px; display: flex; align-items: center; gap: 8px; }
            .tree-node-content { padding-left: 24px; padding-bottom: 8px; padding-right: 8px; }
            .attachment-link { display: block; margin-top: 4px; }
            img { max-width: 100%; height: auto; border-radius: 0.375rem; }
          </style>
        </head>
        <body class="font-body antialiased">
          ${staticHtml}
        </body>
      </html>
    `;

    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const updateActiveTree = (updater: (draft: TreeFile) => void) => {
    performAction(draft => {
        const treeIndex = draft.findIndex(t => t.id === activeTreeId);
        if (treeIndex !== -1) {
            draft[treeIndex] = produce(draft[treeIndex], updater);
        }
    });
  };

  return {
    allTrees: visibleTrees,
    setAllTrees,
    activeTree,
    activeTreeId,
    isTreeDataLoading,
    conflictState,
    setActiveTreeId,
    createNewTree,
    deleteTree,
    updateTreeOrder,
    shareTree: async (treeId: string, userId: string) => {
      performAction((draft) => { const tree = draft.find(t => t.id === treeId); if (tree) { if (!tree.sharedWith) tree.sharedWith = []; tree.sharedWith.push(userId); } });
      await shareTreeWithUser(treeId, userId);
      toast({ title: "Tree Shared", description: "Access has been granted." });
    },
    revokeShare: async (treeId: string, userId: string) => {
      performAction(draft => { const tree = draft.find(t => t.id === treeId); if (tree && tree.sharedWith) { tree.sharedWith = tree.sharedWith.filter(id => id !== userId); } });
      await revokeShareFromUser(treeId, userId);
      toast({ title: "Access Revoked", description: "User access has been removed." });
    },
    setTreePublicStatus: async (treeId: string, isPublic: boolean) => {
      performAction(draft => { const tree = draft.find(t => t.id === treeId); if (tree) tree.isPublic = isPublic; });
      await setTreePublicStatusInDb(treeId, isPublic);
      toast({ title: `Tree is now ${isPublic ? 'Public' : 'Private'}` });
    },
    listExamples: () => listExamplesFromDataService(),
    loadExample: async (fileName: string) => {
      const exampleData = await loadExampleFromFile(fileName);
      if (exampleData) {
        const newTreeId = await importTreeFromJson(exampleData, undefined, true);
        if (newTreeId) {
          toast({ title: "Example Loaded", description: `The "${(exampleData as any).title}" example has been loaded as a new root.` });
          router.push("/");
          return newTreeId;
        }
      }
      toast({ variant: "destructive", title: "Failed to load example", description: `Could not load the example data from ${fileName}.` });
      return null;
    },
    importTreeArchive: async (file: File) => {
      if (!currentUser) throw new Error("You must be logged in to import an archive.");
      const { treeFile, files: fileBlobs } = await readArchive(file);
      const uploadPromises = Object.entries(fileBlobs).map(async ([relativePath, blob]) => {
        try {
          const dataUri = await blobToDataURI(blob);
          const originalFileName = path.basename(relativePath);
          await uploadAttachmentToServer(currentUser.id, originalFileName, dataUri, originalFileName);
        } catch (error) {
          console.error(`Failed to upload file ${relativePath} from archive`, error);
        }
      });
      await Promise.all(uploadPromises);
      await importTreeFromJson(treeFile, undefined, true);
    },
    importTreeFromJson,
    reloadAllTrees,
    reloadActiveTree,
    setTreeTitle,
    setTemplates,
    importTemplates,
    expandedNodeIds: activeTree?.expandedNodeIds ?? [],
    setExpandedNodeIds,
    expandAllFromNode,
    collapseAllFromNode,
    addRootNode,
    addChildNode,
    addSiblingNode,
    updateNode,
    updateNodeNamesForTemplate,
    changeNodeTemplate,
    changeMultipleNodesTemplate,
    deleteNode,
    deleteNodes,
    pasteNodes,
    moveNodes,
    moveNodeOrder,
    pasteNodesAsClones,
    undoLastAction,
    canUndo,
    redoLastAction,
    canRedo,
    undoActionDescription,
    redoActionDescription,
    getSiblingOrderRange,
    findNodeAndParent,
    findNodeAndContextualParent,
    getNodeInstancePaths,
    uploadAttachment: uploadAttachmentToServer,
    commitToRepo,
    fetchRepoHistory,
    syncFromRepo,
    restoreToCommit,
    resolveConflict,
    analyzeStorage: () => getStorageInfo(currentUser!.id),
    purgeStorage: () => purgeUnusedFiles(currentUser!.id),
    toggleStarredForSelectedNodes,
    clipboard,
    setClipboard,
    selectedNodeIds,
    setSelectedNodeIds,
    lastSelectedNodeId,
    setLastSelectedNodeId,
    linkTreeToRepo,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    updateActiveTree,
    // Properties that were missing from TreeContextType
    templates: activeTree?.templates ?? [],
    tree: activeTree?.tree ?? [],
    treeTitle: activeTree?.title ?? "",
    getTemplateById,
    exportNodesAsJson,
    exportNodesAsArchive,
    exportNodesAsHtml,
  };
}

// Dummy blobToDataURI helper if not already available
const blobToDataURI = (blob: Blob): Promise<string> =>
new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    if (e.target && typeof e.target.result === 'string') resolve(e.target.result);
    else reject(new Error("Failed to read blob as Data URI"));
  };
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

/* -------------------------------- Provider --------------------------------- */

interface TreeProviderProps {
  children: React.ReactNode;
  initialTree?: TreeFile;
}

export function TreeProvider({ children, initialTree }: TreeProviderProps) {
  const treeRootsHook = useTreeRoots({initialTree});

  return <TreeContext.Provider value={treeRootsHook}>{children}</TreeContext.Provider>;
}

    
