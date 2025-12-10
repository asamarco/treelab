

/**
 * @fileoverview
 * This component renders the header section of the main tree page, including
 * the tree title, actions like export, sync, and add node.
 */
"use client";

import { useState } from "react";
import { 
    Edit, Download, FileJson, FileText, ChevronDown, Rows, Columns, 
    Archive, GitCommit, Loader2, History, GitPullRequest, Github, 
    CheckCircle, AlertCircle, PlusCircle, Undo2, FileCode, Check,
    Redo2, ListOrdered, Users, RefreshCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { TreeFile } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface TreePageHeaderProps {
    tree: TreeFile;
    isCheckingSync: boolean;
    remoteSha: string | null;
    onTitleSave: (newTitle: string) => void;
    onSync: (treeFile: TreeFile, token: string) => Promise<{ success: boolean; message: string; }>;
    onCommit: () => void;
    onReload: () => void;
}

export function TreePageHeader({ 
    tree, 
    isCheckingSync,
    remoteSha,
    onTitleSave,
    onSync,
    onCommit,
    onReload
}: TreePageHeaderProps) {
    const { currentUser, users } = useAuthContext();
    const {
        canUndo,
        undoLastAction,
        canRedo,
        redoLastAction,
        undoActionDescription,
        redoActionDescription,
        exportNodesAsArchive,
        exportNodesAsHtml,
        exportNodesAsJson,
        tree: allNodes,
        allTrees,
        activeTreeId,
        setActiveTreeId,
    } = useTreeContext();
    const { isCompactView, setIsCompactView, showNodeOrder, setShowNodeOrder, setDialogState } = useUIContext();

    const { toast } = useToast();
    const [isSyncing, setIsSyncing] = useState(false);

    const isOutOfSync = remoteSha && tree.gitSync?.lastSyncSha !== remoteSha;
    const isOwner = tree.userId === currentUser?.id;
    
    const owner = users.find(u => u.id === tree.userId);
    const collaboratorNames = tree.sharedWith
        ?.map(userId => users.find(u => u.id === userId)?.username)
        .filter((name): name is string => !!name);

    const allParticipants = [
        owner ? `${owner.username} (Owner)` : 'Unknown Owner',
        ...(collaboratorNames || [])
    ];
    
    const handleSync = async () => {
        if (!tree || !currentUser?.gitSettings?.githubPat) return;
        setIsSyncing(true);
        toast({ title: "Syncing...", description: "Fetching latest version from repository." });
        try {
            const result = await onSync(tree, currentUser.gitSettings.githubPat);
            toast({ title: "Sync Complete", description: result.message });
        } catch (error) {
            toast({ variant: "destructive", title: "Sync Failed", description: (error as Error).message });
        } finally {
            setIsSyncing(false);
        }
    };
    
    return (
        <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4">
            <div className="group flex items-center gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="text-3xl font-bold p-2 -ml-2 h-auto">
                            {tree.title}
                            <ChevronDown className="ml-2 h-6 w-6 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {allTrees.map(t => (
                            <DropdownMenuItem key={t.id} onSelect={() => setActiveTreeId(t.id)}>
                                <Check className={cn("mr-2 h-4 w-4", activeTreeId === t.id ? 'opacity-100' : 'opacity-0')} />
                                {t.title}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                {isOwner && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity read-only-hidden" onClick={() => setDialogState({ isRenameTreeOpen: true, initialTreeTitle: tree.title })}>
                        <Edit className="h-5 w-5" />
                    </Button>
                )}
                {collaboratorNames && collaboratorNames.length > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Users className="h-5 w-5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-bold">Shared with:</p>
                        <ul className="list-disc pl-4 mt-1">
                            {allParticipants.map(name => <li key={name}>{name}</li>)}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
            </div>
            <div className="flex flex-row flex-wrap gap-2 w-full md:w-auto justify-end">
               <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={undoLastAction} disabled={!canUndo} className="read-only-hidden">
                                <Undo2 className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{undoActionDescription || 'Undo'} (Ctrl+Z)</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={redoLastAction} disabled={!canRedo} className="read-only-hidden">
                                <Redo2 className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{redoActionDescription || 'Redo'} (Ctrl+Y)</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={() => setShowNodeOrder(!showNodeOrder)}>
                                <ListOrdered className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Show numbering (o)</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={onReload}>
                                <RefreshCcw className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>Reload Tree (r)</p></TooltipContent>
                    </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={() => setIsCompactView(!isCompactView)}>
                      {isCompactView ? <Rows className="h-4 w-4" /> : <Columns className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isCompactView ? "Normal View" : "Compact View"} (Space)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download className="mr-2 h-4 w-4" /> Export <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => exportNodesAsJson(allNodes, tree.title)}>
                    <FileJson className="mr-2 h-4 w-4" />
                    Export as JSON
                  </DropdownMenuItem>
                   <DropdownMenuItem onSelect={() => exportNodesAsArchive(allNodes, tree.title)}>
                    <Archive className="mr-2 h-4 w-4" />
                    Export as Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportNodesAsHtml('tree-view-container', allNodes, tree.title)}>
                    <FileCode className="mr-2 h-4 w-4" />
                    Export as HTML
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

               {tree.gitSync && (
                 <div className="flex gap-2 read-only-hidden">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" onClick={() => setDialogState({ isHistoryOpen: true })}>
                              <History className="mr-2 h-4 w-4" /> History
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>View commit history</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" onClick={handleSync} disabled={!isOutOfSync || isSyncing}>
                                {isSyncing ? <Loader2 className="animate-spin mr-2"/> : <GitPullRequest className="mr-2 h-4 w-4" />}
                                Sync
                                {isCheckingSync ? <Loader2 className="animate-spin ml-2 h-3 w-3" /> : (isOutOfSync ? <AlertCircle className="text-destructive ml-2 h-3 w-3"/> : <CheckCircle className="text-primary ml-2 h-3 w-3"/>)}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Sync with remote repository</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                         <Tooltip>
                            <TooltipTrigger asChild>
                              <Button onClick={() => setDialogState({ isCommitOpen: true })}>
                                  <GitCommit className="mr-2 h-4 w-4" /> Commit
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Commit changes</p></TooltipContent>
                         </Tooltip>
                      </TooltipProvider>
                    </>
                 </div>
               )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => setDialogState({ isAddNodeOpen: true })} className="read-only-hidden">
                      <PlusCircle className="mr-2 h-4 w-4" /> Add Node
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Add a new root node</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
        </div>
    );
}
