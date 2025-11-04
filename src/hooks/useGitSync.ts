

import { useState, useCallback } from 'react';
import { TreeFile, User, GitSettings, GitSync, GitCommit, TreeNode } from '@/lib/types';
import {
    createRepo,
    commitTreeFileToRepo as commitTreeFileToRepoOnServer,
    getRepoCommits,
    getLatestCommitSha,
    getTreeFromGit,
    loadTreeFile,
    saveTreeFile,
    deleteTreeFile as deleteTreeFileFromDb,
} from '@/lib/data-service';
import { usePathname } from 'next/navigation';

interface UseGitSyncProps {
    currentUser: User | null;
    allTrees: TreeFile[];
    performAction: (updater: (currentTrees: TreeFile[]) => TreeFile[], isUndoable?: boolean) => void;
    importTreeFromJson: (jsonData: any, user?: User, rewriteAttachmentPaths?: boolean) => Promise<string | null>;
    deleteTree: (treeId: string) => Promise<void>;
    reloadActiveTree: (treeId?: string) => Promise<void>;
    reloadAllTrees: () => Promise<void>;
    setActiveTreeId: (id: string | null) => void;
    replaceTree: (oldTreeId: string, newTreeId: string, metaToKeep: Partial<TreeFile>) => Promise<void>;
}

export function useGitSync({ currentUser, allTrees, performAction, importTreeFromJson, deleteTree, reloadActiveTree, setActiveTreeId, replaceTree, reloadAllTrees }: UseGitSyncProps) {
    const [conflictState, setConflictState] = useState<{ localTree: TreeFile, serverTree: TreeFile } | null>(null);
    const pathname = usePathname();

    const linkTreeToRepo = async (treeId: string, repoOwner: string, repoName: string, branch: string, token: string) => {
        if (!currentUser) {
          throw new Error("No user logged in.");
        }
        const treeToLink = allTrees.find(t => t.id === treeId);
        if (!treeToLink) {
            throw new Error("Tree to link not found.");
        }
        
        const gitSync: GitSync = { repoOwner, repoName, branch, lastSync: new Date().toISOString() };
        
        const updatedTree: TreeFile = { ...treeToLink, gitSync };

        // Persist the change immediately to the database
        const { tree, ...metaData } = updatedTree;
        await saveTreeFile(metaData);

        // Then update the local state
        performAction(prev => {
            return prev.map(t => t.id === treeId ? updatedTree : t)
        }, false); // isUndoable is false as it's a direct save

        console.log(`INFO: Tree '${treeToLink.title}' linked to repo '${repoOwner}/${repoName}'.`);
    };

    const unlinkTreeFromRepo = async (treeId: string) => {
        if (!currentUser) return;
        const treeToUnlink = allTrees.find(t => t.id === treeId);
        if (!treeToUnlink) return;

        const { gitSync, ...restOfTree } = treeToUnlink;
        
        performAction(prev => {
            return prev.map(t => (t.id === treeId ? restOfTree : t));
        });

        // Persist the change to the database immediately
        const { tree, ...metaData } = restOfTree;
        await saveTreeFile(metaData);
        
        console.log(`INFO: Unlinked tree '${treeToUnlink.title}' from repository.`);
    };

    const createAndLinkTreeToRepo = async (treeId: string, repoName: string, isPrivate: boolean, token: string) => {
        console.log(`INFO: Attempting to create and link repo '${repoName}' for tree ID ${treeId}.`);
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

        console.log(`INFO: Committing changes for tree '${treeFile.title}' to repo '${treeFile.gitSync.repoName}'.`);
        try {
            const result = await commitTreeFileToRepoOnServer(token, treeId, message, treeFile);
            if (result.success && result.commitSha) {
                performAction(prev => {
                    const updatedGitSync: GitSync = { 
                        ...treeFile.gitSync!, 
                        lastSync: new Date().toISOString(),
                        lastSyncSha: result.commitSha,
                    };
                    const updatedTree: TreeFile = { ...treeFile, gitSync: updatedGitSync };
                    return prev.map(t => t.id === treeFile.id ? updatedTree : t)
                });
                console.log(`INFO: Commit successful. SHA: ${result.commitSha}`);
            }
            return result;
        } catch (err) {
            const error = err as Error;
            console.error("ERROR: Commit to repo failed:", error);
            return { success: false, error: error.message };
        }
    };

    const fetchRepoHistory = async (treeFile: TreeFile, token: string): Promise<GitCommit[]> => {
        if (!treeFile.gitSync) {
            throw new Error("Tree is not linked to a repository.");
        }
        const { repoOwner, repoName, branch } = treeFile.gitSync;
        console.log(`INFO: Fetching commit history for ${repoOwner}/${repoName}.`);
        return getRepoCommits(token, repoOwner, repoName, branch);
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
            
            const newTreeId = await importTreeFromJson(remoteTreeData);
            if (!newTreeId) {
                throw new Error("Failed to import synced data as a new tree.");
            }

            const oldTreeId = treeFile.id;
            const metaToKeep = {
                title: treeFile.title,
                sharedWith: treeFile.sharedWith,
                gitSync: { ...treeFile.gitSync, lastSync: new Date().toISOString(), lastSyncSha: latestSha },
            };

            await replaceTree(oldTreeId, newTreeId, metaToKeep);
            await reloadAllTrees();
            setActiveTreeId(newTreeId);

            console.log(`INFO: Sync successful. Replaced tree ${oldTreeId} with new tree ${newTreeId}.`);
            return { success: true, message: "Tree successfully synced from repository." };
        } catch (err) {
            const error = err as Error;
            console.error(`ERROR: Sync failed:`, error);
            return { success: false, message: error.message || "An unknown error occurred during sync." };
        }
    }, [currentUser, importTreeFromJson, replaceTree, setActiveTreeId, reloadAllTrees]);
    
    const restoreToCommit = useCallback(async (currentTreeId: string, commitSha: string, token: string) => {
        if (!currentUser) throw new Error("User not logged in");
        
        const treeFile = allTrees.find(t => t.id === currentTreeId);
        if (!treeFile?.gitSync) {
            throw new Error("Tree is not linked to a repository.");
        }
        const { repoOwner, repoName, branch } = treeFile.gitSync;

        console.log(`INFO: Restoring tree '${treeFile.title}' to commit ${commitSha}`);
        
        const remoteTreeData = await getTreeFromGit(token, repoOwner, repoName, commitSha);
        
        const newTreeId = await importTreeFromJson(remoteTreeData);
        if (!newTreeId) {
            throw new Error("Failed to import restored data as a new tree.");
        }
        
        const commitDetails = (await getRepoCommits(token, repoOwner, repoName, treeFile.gitSync.branch)).find(c => c.sha === commitSha);
        const metaToKeep = {
            title: treeFile.title,
            sharedWith: treeFile.sharedWith,
            gitSync: { 
                ...treeFile.gitSync, 
                lastSync: commitDetails?.date || new Date().toISOString(),
                lastSyncSha: commitSha,
            },
        };
        
        await replaceTree(currentTreeId, newTreeId, metaToKeep);

        const restoredTreeFile = await loadTreeFile(newTreeId);
        if (!restoredTreeFile) {
            throw new Error("Failed to load restored tree before committing.");
        }

        const restoreMessage = `Restore to version from ${commitSha.substring(0, 7)}`;
        const result = await commitToRepo(newTreeId, restoreMessage, token, true, restoredTreeFile);

        if (!result.success) {
          console.error(`ERROR: Failed to commit restored version. A manual sync may be required.`);
          throw new Error(result.error || "Failed to commit the restored version.");
        }

        await reloadAllTrees();
        setActiveTreeId(newTreeId);

    }, [currentUser, allTrees, importTreeFromJson, replaceTree, setActiveTreeId, commitToRepo, reloadAllTrees]);
    
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

    return {
        conflictState,
        setConflictState,
        linkTreeToRepo,
        unlinkTreeFromRepo,
        createAndLinkTreeToRepo,
        commitToRepo,
        fetchRepoHistory,
        syncFromRepo,
        restoreToCommit,
        resolveConflict,
        replaceTree,
    };
}

    
