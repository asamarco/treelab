

/**
 * @fileoverview
 * This component manages all the dialogs (modals) for the main tree page.
 * This keeps the modal logic separate from the main page layout.
 */
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { NodeForm } from "@/components/tree/node-form";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { useToast } from "@/hooks/use-toast";
import { Template, TreeFile, GitCommit, TreeNode } from "@/lib/types";
import { Github, Loader2, Eye, AlertTriangle, RefreshCcw, ArrowLeft, ArrowRight, ArrowUp, Printer, Download, FileJson, FileCode, FileText, Archive, ChevronDown, CornerDownRight, ListPlus } from "lucide-react";
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { HtmlExportView } from "./html-export-view";
import { TreeView } from "./tree-view";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useUIContext } from "@/contexts/ui-context";
// import { PdfExportDialog } from "./pdf-export-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";


interface TreePageModalsProps {
    activeTree: TreeFile;
    templates: Template[];
    getTemplateById: (id: string) => Template | undefined;
    onSaveNewRootNode: (newNode: any) => void;
    conflictState: { localTree: TreeFile, serverTree: TreeFile } | null;
    onConflictResolve: (resolution: 'local' | 'server') => Promise<void>;
    syncFromRepo: (treeFile: TreeFile, token: string) => Promise<{ success: boolean; message: string; }>;
}

export function TreePageModals({ 
    activeTree,
    templates,
    getTemplateById,
    onSaveNewRootNode,
    conflictState,
    onConflictResolve,
    syncFromRepo,
}: TreePageModalsProps) {
    const { currentUser } = useAuthContext();
    const { 
        exportNodesAsJson,
        exportNodesAsArchive,
        exportNodesAsHtml,
        commitToRepo,
        fetchRepoHistory,
        restoreToCommit,
        setTreeTitle,
        tree: allNodes,
        findNodeAndParent,
        allTrees,
        setActiveTreeId,
        activeTreeId,
        changeMultipleNodesTemplate,
        selectedNodeIds
    } = useTreeContext();
    const { dialogState, setDialogState } = useUIContext();
    const { toast } = useToast();

    // Add Node Dialog State
    const [selectedTemplateForNewNode, setSelectedTemplateForNewNode] = useState<Template | null>(null);

    // Rename Tree Dialog State
    const [newTitle, setNewTitle] = useState(dialogState.initialTreeTitle || activeTree.title);
     useEffect(() => {
        if (dialogState.isRenameTreeOpen) {
            setNewTitle(dialogState.initialTreeTitle || activeTree.title);
        }
    }, [dialogState.isRenameTreeOpen, dialogState.initialTreeTitle, activeTree.title]);


    // Commit Dialog State
    const [commitMessage, setCommitMessage] = useState("");
    const [isCommitting, setIsCommitting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    // History Dialog State
    const [history, setHistory] = useState<GitCommit[]>([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    
    // Preview Dialog State
    const [previewExpandedNodeIds, setPreviewExpandedNodeIds] = useState<string[]>([]);

    // Change Multiple Templates Dialog State
    const [targetTemplateId, setTargetTemplateId] = useState<string | null>(null);

    const nodesForPreview = useMemo(() => {
      if (!dialogState.isNodePreviewOpen || !dialogState.nodeIdsForPreview) return [];
      
      return dialogState.nodeIdsForPreview.map(id => findNodeAndParent(id, allNodes)?.node).filter((n): n is TreeNode => !!n);

    }, [dialogState.isNodePreviewOpen, dialogState.nodeIdsForPreview, allNodes, findNodeAndParent]);

    const previewNavigation = useMemo(() => {
      if (nodesForPreview.length !== 1) {
        return { prev: null, next: null, parent: null };
      }
      const nodeInfo = findNodeAndParent(nodesForPreview[0].id, allNodes);
      if (!nodeInfo) {
        return { prev: null, next: null, parent: null };
      }
      const { node, parent } = nodeInfo;
      const siblings = parent ? parent.children : allNodes;

      // Note: This simple index based navigation might not be ideal for cloned nodes with multiple parents
      // but for a straightforward preview it's acceptable.
      const currentIndex = siblings.findIndex(s => s.id === node.id);

      const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
      const next = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

      return { prev, next, parent };
    }, [nodesForPreview, findNodeAndParent, allNodes]);

    useEffect(() => {
        if (dialogState.isNodePreviewOpen && nodesForPreview.length > 0) {
            const allIds = new Set<string>();
            const traverse = (nodes: TreeNode[], parentId: string | null) => {
                for (const node of nodes) {
                    allIds.add(`${node.id}_${parentId || 'root'}`);
                    if (node.children) {
                        traverse(node.children, node.id);
                    }
                }
            };
            traverse(nodesForPreview, null);
            setPreviewExpandedNodeIds(Array.from(allIds));
        }
    }, [dialogState.isNodePreviewOpen, nodesForPreview]);


    const handleFetchHistory = useCallback(async () => {
        if (!activeTree?.gitSync || !currentUser?.gitSettings?.githubPat) return;
        setIsHistoryLoading(true);
        try {
            const historyData = await fetchRepoHistory(activeTree, currentUser.gitSettings.githubPat);
            setHistory(historyData);
        } catch (error) {
            toast({ variant: "destructive", title: "Failed to fetch history", description: (error as Error).message });
            setDialogState({ isHistoryOpen: false });
        } finally {
            setIsHistoryLoading(false);
        }
    }, [activeTree, currentUser?.gitSettings?.githubPat, fetchRepoHistory, setDialogState, toast]);
    
    useEffect(() => {
        if (dialogState.isHistoryOpen) {
            handleFetchHistory();
        }
    }, [dialogState.isHistoryOpen, handleFetchHistory]);


    // Event Handlers
    const handleTitleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if(newTitle.trim()){
            setTreeTitle(activeTree.id, newTitle.trim());
            setDialogState({ isRenameTreeOpen: false });
        }
    }

    const handleCommit = async (force: boolean = false) => {
        if (!activeTree?.gitSync || !currentUser?.gitSettings?.githubPat) {
            toast({ variant: "destructive", title: "Cannot Commit", description: "Git integration is not configured correctly." });
            return;
        }
        if (!commitMessage.trim()) {
            toast({ variant: "destructive", title: "Commit Message Required", description: "Please provide a summary of your changes." });
            return;
        }

        setIsCommitting(true);
        
        // Immediately close the appropriate dialog
        if (force) {
            setDialogState({ isOutOfSyncCommitOpen: false });
        } else {
            setDialogState({ isCommitOpen: false });
        }
        
        toast({ title: "Committing...", description: `Pushing changes to ${activeTree.gitSync.repoName}` });

        try {
            const result = await commitToRepo(activeTree.id, commitMessage, currentUser.gitSettings.githubPat, force);
            if (result.success) {
                toast({ title: "Commit Successful", description: `Changes pushed to branch '${activeTree.gitSync.branch}'.` });
                setCommitMessage("");
            } else {
                if (result.error === 'out-of-sync') {
                    setDialogState({ isOutOfSyncCommitOpen: true });
                } else {
                    throw new Error(result.error || "An unknown error occurred.");
                }
            }
        } catch (error) {
            const err = error as Error;
            toast({ variant: "destructive", title: "Commit Failed", description: err.message });
        } finally {
            setIsCommitting(false);
        }
    };
    
    const handleRestoreCommit = async (sha: string) => {
        if (!activeTree || !currentUser?.gitSettings?.githubPat) return;
        setIsRestoring(true);
        toast({title: "Restoring version..."});
        try {
            await restoreToCommit(activeTree.id, sha, currentUser.gitSettings.githubPat);
            setDialogState({ isHistoryOpen: false });
            toast({title: "Restore Complete", description: "The tree has been restored to the selected version."});
        } catch (error) {
            toast({variant: "destructive", title: "Failed to restore version", description: (error as Error).message});
        } finally {
            setIsRestoring(false);
        }
    };

    const handleSyncFromDialog = async () => {
        if (!activeTree || !currentUser?.gitSettings?.githubPat) return;
        setIsSyncing(true);
        setDialogState({ isOutOfSyncCommitOpen: false });
        toast({ title: "Syncing...", description: "Fetching latest version from repository." });
        try {
            const result = await syncFromRepo(activeTree, currentUser.gitSettings.githubPat);
            toast({ title: "Sync Complete", description: result.message });
        } catch (error) {
            toast({ variant: "destructive", title: "Sync Failed", description: (error as Error).message });
        } finally {
            setIsSyncing(false);
        }
    };
    
    const handlePreviewNavigate = (nodeId: string | undefined) => {
        if (nodeId) {
            setDialogState({ nodeIdsForPreview: [nodeId] });
        }
    };
    
    const handlePrint = () => {
      window.print();
    }
    
    const handleExport = (format: 'json' | 'archive' | 'html') => {
        if (nodesForPreview.length === 0) {
            toast({ variant: 'destructive', title: 'Export Error', description: 'Could not find any nodes to export.' });
            return;
        }

        const exportName = `${nodesForPreview.length}-nodes-export`;
        const exportTitle = `${nodesForPreview.length} Selected Nodes`;
        const exportId = 'export-container-selection';
        
        switch (format) {
            case 'json':
                exportNodesAsJson(nodesForPreview, exportName);
                break;
            case 'archive':
                exportNodesAsArchive(nodesForPreview, exportName);
                break;
            case 'html':
                setDialogState({ exportNodes: nodesForPreview, exportTitle, exportElementId: exportId });
                setTimeout(() => {
                    exportNodesAsHtml(exportId, nodesForPreview, exportTitle);
                    setDialogState({ exportNodes: undefined });
                }, 100);
                break;
        }
    };

    const handleChangeMultipleTemplates = () => {
        if (!targetTemplateId) {
            toast({ variant: 'destructive', title: 'No Template Selected' });
            return;
        }
        changeMultipleNodesTemplate(selectedNodeIds, targetTemplateId);
        toast({ title: "Templates Changed", description: `Updated ${selectedNodeIds.length} nodes.` });
        setDialogState({ isChangeTemplateMultipleOpen: false });
        setTargetTemplateId(null);
    };

    return (
        <>
            {/* Add Node Dialog */}
            <Dialog
                open={dialogState.isAddNodeOpen || false}
                onOpenChange={(open) => {
                    setDialogState({ isAddNodeOpen: open });
                    if (!open) setSelectedTemplateForNewNode(null);
                }}
            >
                <DialogContent>
                    <DialogHeader><DialogTitle>Add New Root Node</DialogTitle></DialogHeader>
                    {!selectedTemplateForNewNode ? (
                        <div className="space-y-2 py-4">
                            <Label>Select a template for the new node</Label>
                            <Select onValueChange={(templateId) => setSelectedTemplateForNewNode(getTemplateById(templateId) ?? null)}>
                                <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                                <SelectContent>
                                    {templates.map((t) => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : (
                        <NodeForm
                            template={selectedTemplateForNewNode}
                            onSave={(newNode) => {
                                onSaveNewRootNode(newNode);
                                setDialogState({ isAddNodeOpen: false });
                                setSelectedTemplateForNewNode(null);
                            }}
                            onClose={() => {
                                setDialogState({ isAddNodeOpen: false });
                                setSelectedTemplateForNewNode(null);
                            }}
                            contextualParentId={null}
                        />
                    )}
                </DialogContent>
            </Dialog>

             {/* Node Preview Dialog */}
            <Dialog open={dialogState.isNodePreviewOpen || false} onOpenChange={(open) => setDialogState({ isNodePreviewOpen: open, nodeIdsForPreview: open ? dialogState.nodeIdsForPreview : undefined })}>
                <DialogContent className="max-w-[90vw] max-h-[80vh] flex flex-col printable-area">
                    <DialogHeader className="no-print">
                      <DialogTitle className="sr-only">Node Preview</DialogTitle>
                    </DialogHeader>
                    <div id="node-preview-content" className="flex-1 overflow-y-auto -mx-6 px-6">
                        {nodesForPreview.length > 0 && (
                            <TreeView 
                                nodes={nodesForPreview} 
                                initialExpandedIds={new Set(previewExpandedNodeIds)}
                            />
                        )}
                    </div>
                    <DialogFooter className="border-t pt-2 -mx-6 px-6 no-print">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline">
                                <Download className="mr-2 h-4 w-4" /> Export <ChevronDown className="ml-2 h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => handleExport('json')}><FileJson className="mr-2 h-4 w-4" />JSON</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => handleExport('html')}><FileCode className="mr-2 h-4 w-4" />HTML</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => handleExport('archive')}><Archive className="mr-2 h-4 w-4" />Archive (.zip)</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button variant="outline" onClick={handlePrint}>
                            <Printer className="mr-2 h-4 w-4"/>
                            Print
                          </Button>
                          <div className="flex-grow"></div>
                          {nodesForPreview.length === 1 && (
                            <>
                              <Button variant="outline" onClick={() => handlePreviewNavigate(previewNavigation.prev?.id)} disabled={!previewNavigation.prev}>
                                  <ArrowLeft className="mr-2 h-4 w-4" /> Previous Node
                              </Button>
                               <Button variant="outline" onClick={() => handlePreviewNavigate(previewNavigation.parent?.id)} disabled={!previewNavigation.parent}>
                                  <ArrowUp className="mr-2 h-4 w-4" /> Parent Node
                              </Button>
                              <Button variant="outline" onClick={() => handlePreviewNavigate(previewNavigation.next?.id)} disabled={!previewNavigation.next}>
                                   Next Node <ArrowRight className="ml-2 h-4 w-4" />
                              </Button>
                            </>
                          )}
                      </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Tree Dialog */}
            <Dialog open={dialogState.isRenameTreeOpen || false} onOpenChange={(open) => setDialogState({ isRenameTreeOpen: open })}>
                <DialogContent>
                    <form onSubmit={handleTitleSave}>
                        <DialogHeader><DialogTitle>Rename Root</DialogTitle></DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="tree-title" className="text-right">Title</Label>
                                <Input id="tree-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="col-span-3" />
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                            <Button type="submit">Save</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Commit Dialog */}
            <Dialog open={dialogState.isCommitOpen || false} onOpenChange={(open) => setDialogState({ isCommitOpen: open })}>
                <DialogContent>
                    <form onSubmit={(e) => { e.preventDefault(); handleCommit(false); }}>
                        <DialogHeader>
                            <DialogTitle>Commit Changes to GitHub</DialogTitle>
                            {activeTree.gitSync?.lastSync && (
                                <DialogDescription>
                                    Last sync: {formatDistanceToNow(new Date(activeTree.gitSync.lastSync), { addSuffix: true })}
                                </DialogDescription>
                            )}
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="commit-message">Commit Message</Label>
                                <Textarea id="commit-message" placeholder="e.g., Add initial project structure" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} required />
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={isCommitting}>
                                {isCommitting && <Loader2 className="animate-spin mr-2" />}
                                Commit and Push
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            
             {/* Out of Sync Commit Dialog */}
            <Dialog open={dialogState.isOutOfSyncCommitOpen || false} onOpenChange={(open) => setDialogState({ isOutOfSyncCommitOpen: open })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/>Remote Changes Detected</DialogTitle>
                        <DialogDescription>
                            Your local version is out of sync with the remote repository. To avoid losing data, please choose an option below.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-2 pt-4">
                        <Button variant="destructive" onClick={() => handleCommit(true)}>
                            Force Commit (Overwrite Remote)
                        </Button>
                        <Button variant="outline" onClick={handleSyncFromDialog} disabled={isSyncing}>
                             {isSyncing && <Loader2 className="animate-spin mr-2" />}
                            Sync (Lose Local Changes)
                        </Button>
                    </div>
                     <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="ghost" className="w-full">Cancel</Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* History Dialog */}
            <Dialog open={dialogState.isHistoryOpen || false} onOpenChange={(open) => setDialogState({ isHistoryOpen: open })}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Commit History for {activeTree?.gitSync?.repoName}</DialogTitle></DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto">
                        {isHistoryLoading ? (
                            <div className="flex justify-center items-center h-48"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>
                        ) : history.length > 0 ? (
                            <ul className="space-y-4">
                                {history.map(commit => (
                                    <li key={commit.sha} className="flex items-start gap-4">
                                        <Github className="h-5 w-5 mt-1 text-muted-foreground"/>
                                        <div className="flex-1">
                                            <p className="font-medium">{commit.message}</p>
                                            <p className="text-sm text-muted-foreground">{commit.author} committed {formatDistanceToNow(parseISO(commit.date))} ago</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" size="sm" disabled={isRestoring}>
                                                        {isRestoring ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <RefreshCcw className="mr-2 h-4 w-4"/>} 
                                                        Restore
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Are you sure you want to restore?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will replace your current tree with the version from this commit. All local changes made since the last commit will be lost. This action will create a new commit for the restoration.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleRestoreCommit(commit.sha)} className="bg-destructive hover:bg-destructive/90">
                                                            Restore to this Version
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                            <Button variant="ghost" size="sm" asChild>
                                                <a href={`https://github.com/${activeTree?.gitSync?.repoOwner}/${activeTree?.gitSync?.repoName}/commit/${commit.sha}`} target="_blank" rel="noopener noreferrer">
                                                    <span className="font-mono text-xs">{commit.sha.substring(0, 7)}</span>
                                                </a>
                                            </Button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-muted-foreground text-center">No commit history found.</p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
            
            {/* Hidden render target for PDF/HTML exports */}
            {dialogState.exportNodes && (
                <div id={dialogState.exportElementId} className="hidden printable-area">
                    <HtmlExportView
                        nodes={dialogState.exportNodes}
                        title={dialogState.exportTitle || 'Export'}
                        getTemplateById={getTemplateById}
                        imageMap={new Map()}
                        attachmentsMap={new Map()}
                        currentUser={currentUser}
                    />
                </div>
            )}

            {/* Conflict Resolution Dialog */}
             <Dialog open={!!conflictState} onOpenChange={(open) => !open && onConflictResolve('server')}>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/>Out of Sync</DialogTitle>
                    <DialogDescription>
                    This tree has been updated in another browser tab or session. How would you like to proceed?
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onConflictResolve('server')}>
                    Discard my changes and load the latest version
                    </Button>
                    <Button variant="destructive" onClick={() => onConflictResolve('local')}>
                    Overwrite with my changes
                    </Button>
                </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Change Multiple Templates Dialog */}
            <Dialog open={dialogState.isChangeTemplateMultipleOpen || false} onOpenChange={(open) => { setDialogState({ isChangeTemplateMultipleOpen: open }); if (!open) setTargetTemplateId(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Change Template for {selectedNodeIds.length} Nodes</DialogTitle>
                        <DialogDescription>Select the new template to apply to all selected nodes.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                        <Label htmlFor="multi-change-template-select">New Template</Label>
                        <Select onValueChange={setTargetTemplateId}>
                            <SelectTrigger id="multi-change-template-select">
                                <SelectValue placeholder="Select a template..." />
                            </SelectTrigger>
                            <SelectContent>
                                {templates.map(t => (
                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                        <Button onClick={handleChangeMultipleTemplates} disabled={!targetTemplateId}>Apply to All</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );

    
}
