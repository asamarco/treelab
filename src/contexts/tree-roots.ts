

/**
 * @fileoverview
 * This module encapsulates all logic for managing the collection of tree files ("roots").
 * It handles creating, loading, deleting, sharing, importing, exporting, and syncing trees.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from 'next/navigation';
import { useImmer } from "use-immer";
import { useToast } from "@/hooks/use-toast";
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
} from "@/lib/types";
import { 
    loadAllTreeFiles,
    createTreeFile as createTreeFileInDb,
    loadTreeFile,
    saveTreeFile,
    deleteTreeFile as deleteTreeFileFromDb,
    listExamples as listExamplesFromDataService,
    loadExampleFromFile,
    updateTreeOrder as updateTreeOrderInDb,
    createRepo,
    commitTreeFileToRepo as commitTreeFileToRepoOnServer,
    getRepoCommits,
    getLatestCommitSha,
    getTreeFromGit,
    saveAttachment as uploadAttachmentToServer,
    fetchFileAsBuffer,
    batchCreateNodes,
    createNode as createNodeInDb,
    updateNode as updateNodeInDb,
    deleteNodeWithChildren,
    batchUpdateNodes,
    addParentToNode,
    reorderSiblings,
} from "@/lib/data-service";
import { getStorageInfo, purgeUnusedFiles } from "@/lib/storage-service";
import { readArchive } from "@/lib/archive";
import { useAuthContext } from "./auth-context";
import path from 'path';
import { deepCloneNode, generateClientSideId, generateNodeName } from "@/lib/utils";
import type { WritableDraft } from 'immer';
import { useDebouncedCallback } from "use-debounce";


// Helper to create a default tree structure
const createDefaultTreeFile = (title: string, userId: string, order: number) => ({
  treeFile: { title, userId, templates: [], expandedNodeIds: [], order, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  initialNodes: [],
});

interface UseTreeRootsProps {
    initialTree?: TreeFile;
}

export function useTreeRoots({ initialTree }: UseTreeRootsProps = {}) {
  const { currentUser, setLastActiveTreeId: setLastActiveTreeIdForUser } = useAuthContext();
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isTreeDataLoading, setIsTreeDataLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const [allTrees, setAllTrees] = useImmer<TreeFile[]>(initialTree ? [JSON.parse(JSON.stringify(initialTree))] : []);
  const [historyStack, setHistoryStack] = useImmer<TreeFile[][]>([]);
  const [redoStack, setRedoStack] = useImmer<TreeFile[][]>([]);
  const [activeTreeId, _setActiveTreeId] = useState<string | null>(initialTree ? initialTree.id : null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [conflictState, setConflictState] = useState<{ localTree: TreeFile, serverTree: TreeFile } | null>(null);

  const { toast } = useToast();
  
  const performAction = useCallback(
    (updater: (draft: WritableDraft<TreeFile[]>) => void, isUndoable: boolean = true) => {
      if (isUndoable) {
        // Snapshot the current state BEFORE the update for the undo stack.
        // Critical: Ensure the expanded state of the active tree is captured.
        const currentState = JSON.parse(JSON.stringify(allTrees));
        const activeTreeInCurrentState = currentState.find((t: TreeFile) => t.id === activeTreeId);
        const activeTreeInMemory = allTrees.find(t => t.id === activeTreeId);
        
        if (activeTreeInCurrentState && activeTreeInMemory) {
          activeTreeInCurrentState.expandedNodeIds = activeTreeInMemory.expandedNodeIds;
        }

        setHistoryStack((draft) => {
          draft.push(currentState);
          if (draft.length > 20) draft.shift();
        });
        setRedoStack([]);
      }

      const wrappedUpdater = (draft: WritableDraft<TreeFile[]>) => {
        updater(draft);
        const activeTreeToUpdate = draft.find(t => t.id === activeTreeId);
        if (activeTreeToUpdate) {
            const index = draft.findIndex(t => t.id === activeTreeId);
            if (index !== -1) {
                // Do not update the timestamp here; let the caller decide when to do it.
            }
        }
      };

      setAllTrees(wrappedUpdater);
      setIsDirty(true);
    },
    [allTrees, setAllTrees, setHistoryStack, setRedoStack, activeTreeId]
  );
  
  const canUndo = historyStack.length > 0;
  const canRedo = redoStack.length > 0;
  
  const undoLastAction = useCallback(() => {
    if (historyStack.length > 0) {
      const currentState = JSON.parse(JSON.stringify(allTrees));
      const lastState = historyStack[historyStack.length - 1];
      setRedoStack((draft) => {
        draft.push(currentState);
      });
      setAllTrees(() => lastState); // Directly set to the previous state
      setIsDirty(true);
      setHistoryStack((draft) => {
        draft.pop();
      });
    }
  }, [historyStack, allTrees, setAllTrees, setHistoryStack, setRedoStack]);
  
  const redoLastAction = useCallback(() => {
    if (redoStack.length > 0) {
      const currentState = JSON.parse(JSON.stringify(allTrees));
      const nextState = redoStack[redoStack.length - 1];
      setHistoryStack((draft) => {
        draft.push(currentState);
      });
      setAllTrees(() => nextState);
      setIsDirty(true);
      setRedoStack((draft) => {
        draft.pop();
      });
    }
  }, [redoStack, allTrees, setAllTrees, setHistoryStack, setRedoStack]);

  const activeTree = allTrees.find((t) => t.id === activeTreeId);
  
  const reloadAllTrees = useCallback(async () => {
    if (!currentUser) return;
    console.log("INFO: Reloading all trees from server...");
    const loadedTrees = await loadAllTreeFiles(currentUser.id);
    loadedTrees.sort((a,b) => (a.order || 0) - (b.order || 0));
    setAllTrees(() => loadedTrees);
  }, [currentUser, setAllTrees]);

  const reloadActiveTree = useCallback(
    async (treeIdToLoad?: string) => {
      const idToLoad = treeIdToLoad || activeTreeId;
      if (!idToLoad) return;
      console.log(`INFO: Reloading active tree (${idToLoad}) from server.`);
      const reloadedTree = await loadTreeFile(idToLoad);
      if (reloadedTree) {
        setAllTrees((draft) => {
            const index = draft.findIndex(t => t.id === idToLoad);
            if (index > -1) {
                // Preserve expanded state while updating everything else
                draft[index] = { ...reloadedTree, expandedNodeIds: draft[index].expandedNodeIds };
            }
        });
      } else {
        console.error(`ERROR: Failed to reload tree with ID ${idToLoad}.`);
      }
    },
    [activeTreeId, setAllTrees]
  );

  const createNewTree = useCallback(
    async (title: string, user?: User): Promise<string | null> => {
      const userToCreateFor = user || currentUser;
      if (!userToCreateFor) return null;
      const newOrder = allTrees.length;
      const { treeFile, initialNodes } = createDefaultTreeFile(title, userToCreateFor.id, newOrder);

      const createdTree = await createTreeFileInDb(
        treeFile,
        initialNodes
      );

      const fullCreatedTree = await loadTreeFile(createdTree.id);
      if (fullCreatedTree) {
        performAction((draft) => {draft.push(fullCreatedTree)}, false);
        _setActiveTreeId(fullCreatedTree.id);
        return fullCreatedTree.id;
      }
      return null;
    },
    [currentUser, allTrees, performAction]
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
      const linkRegex = /node:\/\/([a-zA-Z0-9_.:-]+)/g;

      // Second pass: remap parentIds and internal links
      nodeDataToCreate.forEach((node) => {
        // Remap parentIds
        if (node.parentIds) {
          node.parentIds = node.parentIds.map((pid) => idMap.get(pid)!).filter(Boolean);
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
        performAction((draft) => {draft.push(finalTree)}, false);
        _setActiveTreeId(treeId);
        return finalTree.id;
      }
      return null;
    },
    [currentUser, allTrees, performAction]
  );

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
          _setActiveTreeId(lastActiveTreeId);
        } else {
          _setActiveTreeId(loadedTrees[0]?.id || null);
        }

      } catch (error) {
        console.error("ERROR: Failed to initialize auth:", error);
      } finally {
        setIsDataLoaded(true);
        setIsTreeDataLoading(false);
      }
    },
    [createNewTree, importTreeFromJson, setAllTrees]
  );

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
      _setActiveTreeId(null);
      setHistoryStack(() => []);
      setRedoStack(() => []);
      setIsDataLoaded(false);
      setIsTreeDataLoading(true);
    }
  }, [currentUser, isDataLoaded, loadUserSpecificData, setAllTrees, setHistoryStack, setRedoStack, initialTree]);


  const setActiveTreeId = (id: string | null) => {
    _setActiveTreeId(id);
    setHistoryStack(() => []);
    setRedoStack(() => []);
    setLastActiveTreeIdForUser(id);
  };
  
  const deleteTree = async (id: string) => {
    if (!currentUser) return;
    const treeToDelete = allTrees.find((t) => t.id === id);
    if (!treeToDelete) return;

    try {
      await deleteTreeFileFromDb(id);

      performAction((draft) => {
        const index = draft.findIndex(t => t.id === id);
        if (index > -1) draft.splice(index, 1);
      }, false);

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

  const updateTreeOrder = async (updates: { id: string; order: number }[]) => {
    await updateTreeOrderInDb(updates);
    performAction(draft => {
        updates.forEach(({ id, order }) => {
            const tree = draft.find(t => t.id === id);
            if (tree) tree.order = order;
        });
        draft.sort((a,b) => (a.order || 0) - (b.order || 0));
    }, false);
  };

  const shareTree = async (treeId: string, userId: string) => {
      const tree = allTrees.find(t => t.id === treeId);
      if (!tree || tree.userId !== currentUser?.id) return;
      const updatedSharedWith = [...(tree.sharedWith || []), userId];
      await saveTreeFile({ id: treeId, sharedWith: updatedSharedWith });
      performAction(draft => {
          const treeToUpdate = draft.find(t => t.id === treeId);
          if (treeToUpdate) treeToUpdate.sharedWith = updatedSharedWith;
      });
      toast({ title: "Tree Shared", description: "Access has been granted to the user." });
  };

  const revokeShare = async (treeId: string, userId: string) => {
      const tree = allTrees.find(t => t.id === treeId);
      if (!tree || tree.userId !== currentUser?.id) return;
      const updatedSharedWith = (tree.sharedWith || []).filter(id => id !== userId);
      await saveTreeFile({ id: treeId, sharedWith: updatedSharedWith });
      performAction(draft => {
          const treeToUpdate = draft.find(t => t.id === treeId);
          if (treeToUpdate) treeToUpdate.sharedWith = updatedSharedWith;
      });
      toast({ title: "Access Revoked", description: "The user no longer has access to this tree." });
  };
  
  const setTreePublicStatus = async (treeId: string, isPublic: boolean) => {
      const tree = allTrees.find((t) => t.id === treeId);
      if (!tree || tree.userId !== currentUser?.id) return;
      await saveTreeFile({ id: treeId, isPublic });
      performAction((draft) => {
        const treeToUpdate = draft.find((t) => t.id === treeId);
        if (treeToUpdate) treeToUpdate.isPublic = isPublic;
      });
      toast({
        title: `Tree is now ${isPublic ? 'Public' : 'Private'}`,
        description: isPublic ? 'Anyone with the link can view this tree.' : 'Only invited users can access this tree.',
      });
  };

  const listExamples = async (): Promise<ExampleInfo[]> => {
    return listExamplesFromDataService();
  };

  const loadExample = async (fileName: string): Promise<string | null> => {
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
  };
  
  const uploadAttachment = async (relativePath: string, dataUri: string, fileName: string, ownerId: string): Promise<AttachmentInfo | null> => {
    if (!ownerId) return null;
    try {
      const formData = new FormData();
      formData.append("file", dataUri);
      formData.append("fileName", fileName);
      formData.append("relativePath", relativePath);
      formData.append("userId", ownerId);
      const response = await fetch("/api/upload/attachment", { method: "POST", body: formData });
      if (!response.ok) throw new Error((await response.json()).message || "Upload failed");
      return (await response.json()).attachmentInfo;
    } catch (error) {
      return null;
    }
  };

  const importTreeArchive = async (file: File) => {
    if (!currentUser) throw new Error("You must be logged in to import an archive.");
    const { treeFile, files: fileBlobs } = await readArchive(file);
    const uploadPromises = Object.entries(fileBlobs).map(async ([relativePath, blob]) => {
      try {
        const dataUri = await blobToDataURI(blob);
        const originalFileName = path.basename(relativePath);
        await uploadAttachment(originalFileName, dataUri, originalFileName, currentUser.id);
      } catch (error) {
        console.error(`Failed to upload file ${relativePath} from archive`, error);
      }
    });
    await Promise.all(uploadPromises);
    await importTreeFromJson(treeFile, undefined, true);
  };
  
  const debouncedSave = useDebouncedCallback((treeToSave: TreeFile) => {
    if (currentUser && !isSaving) {
      setIsSaving(true);
      const newUpdatedAt = new Date().toISOString();
      const { tree, ...metaData } = { ...treeToSave, updatedAt: newUpdatedAt };
  
      saveTreeFile(metaData).then(() => {
        // After successful save, update the local state with the new timestamp
        setAllTrees((draft) => {
          const treeInDraft = draft.find((t) => t.id === treeToSave.id);
          if (treeInDraft) {
            treeInDraft.updatedAt = newUpdatedAt;
          }
        });
        setIsDirty(false);
        setIsSaving(false);
        console.log(`INFO: Debounced save for tree '${treeToSave.title}' executed successfully.`);
      }).catch(error => {
        console.error("ERROR: Debounced save failed:", error);
        setIsSaving(false);
      });
    }
  }, 1000);

  useEffect(() => {
    if (isDirty && activeTree && !isSaving) {
      debouncedSave(activeTree);
    }
  }, [isDirty, activeTree, debouncedSave, isSaving]);

  const updateActiveTree = (updater: (draft: TreeFile) => void) => {
    performAction((draft) => {
      const treeToUpdate = draft.find((t) => t.id === activeTreeId);
      if (treeToUpdate) {
        updater(treeToUpdate);
      }
    }, false);
    setIsDirty(true);
  };
  
  const setTreeTitle = (treeId: string, title: string) => {
    const tree = allTrees.find((t) => t.id === treeId);
    if (!tree || tree.userId !== currentUser?.id) return;
    performAction((draft) => {
      const treeToUpdate = draft.find(t => t.id === treeId);
      if (treeToUpdate) treeToUpdate.title = title;
    });
  };
  
  // Git Sync and Storage management functions would also go here
  const linkTreeToRepo = async (treeId: string, repoOwner: string, repoName: string, branch: string, token: string) => {
      if (!currentUser) {
        throw new Error("No user logged in.");
      }
    
      const gitSync = { repoOwner, repoName, branch, lastSync: new Date().toISOString() };
      
      // Persist the change to the database in the background
      const treeToUpdate = allTrees.find(t => t.id === treeId);
      if (treeToUpdate) {
        const { tree, ...metaData } = { ...treeToUpdate, gitSync };
        try {
          await saveTreeFile(metaData);
          // On success, update the local state
          performAction(draft => {
              const index = draft.findIndex(t => t.id === treeId);
              if (index !== -1) {
                  draft[index].gitSync = gitSync;
              }
          }, false);
          console.log(`INFO: Tree '${treeToUpdate.title}' linked to repo '${repoOwner}/${repoName}'.`);
        } catch (error) {
          // Handle failure
          toast({ variant: 'destructive', title: 'Linking Failed', description: 'Could not save the repository link.' });
        }
      }
  };
  const unlinkTreeFromRepo = async (treeId: string) => {
      if (!currentUser) return;
      const treeToUnlink = allTrees.find(t => t.id === treeId);
      if (!treeToUnlink) return;

      const { gitSync, ...restOfTree } = treeToUnlink;
      
      // Persist the change to the database immediately
      const { tree, ...metaData } = restOfTree;
      try {
          await saveTreeFile(metaData);
          // On success, update the local state
          performAction(draft => {
            const index = draft.findIndex(t => t.id === treeId);
            if (index > -1) {
                delete draft[index].gitSync;
            }
          });
          console.log(`INFO: Unlinked tree '${treeToUnlink.title}' from repository.`);
      } catch(error) {
          toast({ variant: 'destructive', title: 'Unlinking Failed', description: 'Could not save the change.' });
      }
  };
  const createAndLinkTreeToRepo = async (treeId: string, repoName: string, isPrivate: boolean, token: string) => {
      const result = await createRepo(token, repoName, isPrivate);
      if (result.success && result.repo) {
          await linkTreeToRepo(treeId, result.repo.owner, result.repo.name, result.repo.defaultBranch, token);
      } else {
          throw new Error(result.error || 'Failed to create and link repository.');
      }
  };
  const commitToRepo = async (treeId: string, message: string, token: string, force: boolean = false, treeFileToCommit?: TreeFile): Promise<{ success: boolean; error?: string, commitSha?: string }> => {
    const treeFile = treeFileToCommit || allTrees.find(t => t.id === treeId);
    if (!treeFile?.gitSync || !currentUser) {
        return { success: false, error: "Tree is not linked to a repository." };
    }

    if (!force) {
        const latestSha = await getLatestCommitSha(token, treeFile.gitSync.repoOwner, treeFile.gitSync.repoName, treeFile.gitSync.branch);
        if (latestSha !== treeFile.gitSync.lastSyncSha) {
            return { success: false, error: 'out-of-sync' };
        }
    }

    try {
        const result = await commitTreeFileToRepoOnServer(token, treeId, message, treeFile);
        if (result.success && result.commitSha) {
            performAction(draft => {
                const treeToUpdate = draft.find(t => t.id === treeFile.id);
                if (treeToUpdate && treeToUpdate.gitSync) {
                    treeToUpdate.gitSync.lastSync = new Date().toISOString();
                    treeToUpdate.gitSync.lastSyncSha = result.commitSha;
                }
            }, false);
        }
        return result;
    } catch (err) {
        const error = err as Error;
        return { success: false, error: error.message };
    }
  };
  const fetchRepoHistory = async (treeFile: TreeFile, token: string): Promise<GitCommit[]> => {
      if (!treeFile.gitSync) throw new Error("Tree is not linked to a repository.");
      return getRepoCommits(token, treeFile.gitSync.repoOwner, treeFile.gitSync.repoName, treeFile.gitSync.branch);
  };
  const syncFromRepo = useCallback(async (treeFile: TreeFile, token: string): Promise<{ success: boolean; message: string; }> => {
    if (!treeFile?.gitSync || !currentUser) {
        return { success: false, message: "Tree is not linked to a repository." };
    }
    const { repoOwner, repoName, branch, lastSyncSha } = treeFile.gitSync;
    console.log(`INFO: Syncing tree '${treeFile.title}' from remote.`);
    try {
        const latestSha = await getLatestCommitSha(token, repoOwner, repoName, branch);

        if (latestSha === lastSyncSha) {
            console.log(`INFO: Tree is already up-to-date with remote.`);
            return { success: true, message: "Already up-to-date." };
        }

        const remoteTreeData = await getTreeFromGit(token, repoOwner, repoName, latestSha);
        
        // Delete the old tree first
        const oldTreeId = treeFile.id;
        await deleteTreeFileFromDb(oldTreeId);
        
        // Now import the new data, making sure to preserve key metadata
        const mergedData = {
            ...remoteTreeData,
            title: treeFile.title,
            sharedWith: treeFile.sharedWith,
            order: treeFile.order,
            gitSync: { ...treeFile.gitSync, lastSync: new Date().toISOString(), lastSyncSha: latestSha },
        };
        
        const newTreeId = await importTreeFromJson(mergedData, currentUser, true);
        if (!newTreeId) {
            throw new Error("Failed to import synced data as a new tree.");
        }
        
        // Reload all trees to get the correct state from the server.
        await reloadAllTrees();
        
        // Set the newly created tree as active
        setActiveTreeId(newTreeId);

        return { success: true, message: "Tree successfully synced from repository." };
    } catch (err) {
        const error = err as Error;
        console.error(`ERROR: Sync failed:`, error);
        // If sync fails, we must reload to get back to a known good state.
        await reloadAllTrees();
        return { success: false, message: error.message || "An unknown error occurred during sync." };
    }
  }, [currentUser, importTreeFromJson, setActiveTreeId, reloadAllTrees]);
  
  const restoreToCommit = useCallback(async (currentTreeId: string, commitSha: string, token: string) => {
    if (!currentUser) throw new Error("User not logged in");
    
    const treeFile = allTrees.find(t => t.id === currentTreeId);
    if (!treeFile?.gitSync) throw new Error("Tree is not linked to a repository.");
    
    const { repoOwner, repoName, branch } = treeFile.gitSync;
    const remoteTreeData = await getTreeFromGit(token, repoOwner, repoName, commitSha);
    
    const commitDetails = (await getRepoCommits(token, repoOwner, repoName, treeFile.gitSync.branch)).find(c => c.sha === commitSha);
    
    // Delete the old tree
    await deleteTreeFileFromDb(currentTreeId);
    
    // Then, import the restored data as a new tree with preserved metadata
    const mergedData = {
        ...remoteTreeData,
        title: treeFile.title,
        sharedWith: treeFile.sharedWith,
        order: treeFile.order,
        gitSync: { 
            ...treeFile.gitSync, 
            lastSync: commitDetails?.date || new Date().toISOString(),
            lastSyncSha: commitSha, // Set to the restored commit SHA
        },
    };
    
    const newTreeId = await importTreeFromJson(mergedData, currentUser, true);
    if (!newTreeId) {
        throw new Error("Failed to import restored data as a new tree.");
    }
    
    // The restore itself is a change that should be committed
    const restoredTreeFile = await loadTreeFile(newTreeId);
    if (!restoredTreeFile) throw new Error("Failed to load restored tree before committing.");

    const restoreMessage = `Restore to version from ${commitSha.substring(0, 7)}`;
    const result = await commitToRepo(newTreeId, restoreMessage, token, true, restoredTreeFile);

    if (!result.success) {
        console.error(`ERROR: Failed to commit restored version. A manual sync may be required.`);
    }

    await reloadAllTrees();
    setActiveTreeId(newTreeId);

  }, [currentUser, allTrees, importTreeFromJson, setActiveTreeId, commitToRepo, reloadAllTrees]);
  
  const resolveConflict = async (resolution: 'local' | 'server') => {
      if (!conflictState || !currentUser) return;
      const { localTree, serverTree } = conflictState;

      if (resolution === 'server') {
          performAction(prev => prev.map(t => t.id === serverTree.id ? serverTree : t));
      } else {
          const { tree, ...metaData } = localTree;
          performAction(prev => prev.map(t => t.id === localTree.id ? localTree : t));
      }
      setConflictState(null);
  };
  const analyzeStorage = async (treeId?: string): Promise<StorageInfo> => {
      if (!currentUser) return { totalSize: 0, totalCount: 0, purgeableSize: 0, purgeableCount: 0 };
      return getStorageInfo(currentUser.id, treeId);
  };
  const purgeStorage = async (treeId?: string): Promise<PurgeResult | null> => {
      if (!currentUser) return null;
      return purgeUnusedFiles(currentUser.id, treeId);
  };

  return {
    allTrees,
    setAllTrees,
    activeTree,
    activeTreeId,
    isTreeDataLoading,
    historyStack,
    redoStack,
    canUndo,
    canRedo,
    setActiveTreeId,
    undoLastAction,
    redoLastAction,
    performAction,
    createNewTree,
    deleteTree,
    updateTreeOrder,
    shareTree,
    revokeShare,
    setTreePublicStatus,
    listExamples,
    loadExample,
    importTreeArchive,
    importTreeFromJson,
    reloadAllTrees,
    reloadActiveTree,
    setTreeTitle,
    uploadAttachment,
    linkTreeToRepo,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    commitToRepo,
    fetchRepoHistory,
    syncFromRepo,
    restoreToCommit,
    conflictState,
    resolveConflict,
    analyzeStorage,
    purgeStorage,
    updateActiveTree,
  };
}

// Dummy blobToDataURI helper if not already available
const blobToDataURI = (blob: Blob): Promise<string> =>
new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    if (e.target && typeof e.target.result === "string") resolve(e.target.result);
    else reject(new Error("Failed to read blob as Data URI"));
  };
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

    

    