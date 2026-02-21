
"use client";

import { useState } from "react";
import { 
    Edit, Download, FileJson, FileText, ChevronDown, Rows, Rows3, 
    Archive, GitCommit, Loader2, History, GitPullRequest, Github, 
    PlusCircle, Undo2, FileCode, Check,
    Redo2, ListOrdered, Users, RefreshCcw, Menu, LayoutPanelLeft, Search, Star, Filter,
    Globe
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface TreePageHeaderProps {
    tree: TreeFile;
    isCheckingSync: boolean;
    remoteSha: string | null;
    onTitleSave: (newTitle: string) => void;
    onSync: (treeFile: TreeFile, token: string) => Promise<{ success: boolean; message: string; }>;
    onCommit: () => void;
    onReload: () => void;
    searchTerm: string;
    setSearchTerm: (val: string) => void;
    showStarred: boolean;
    setShowStarred: (val: boolean) => void;
    activeFilterCount: number;
    onFilterClick: () => void;
    renderFilterContent: () => React.ReactNode;
}

export function TreePageHeader({ 
    tree, 
    isCheckingSync,
    remoteSha,
    onTitleSave,
    onSync,
    onCommit,
    onReload,
    searchTerm,
    setSearchTerm,
    showStarred,
    setShowStarred,
    activeFilterCount,
    onFilterClick,
    renderFilterContent
}: TreePageHeaderProps) {
    const { currentUser } = useAuthContext();
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
    const { isCompactView, setIsCompactView, showNodeOrder, setShowNodeOrder, setDialogState, isTwoPanelMode, setIsTwoPanelMode } = useUIContext();
    const isMobile = useIsMobile();

    const { toast } = useToast();
    const [isSyncing, setIsSyncing] = useState(false);

    const isOutOfSync = remoteSha && tree.gitSync?.lastSyncSha !== remoteSha;
    const isOwner = tree.userId === currentUser?.id;
    
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
    
    const handlePublicExportClick = () => {
        if (!currentUser) {
            toast({
                variant: 'destructive',
                title: 'Feature Disabled',
                description: 'This export option is not available on public pages.',
            });
        }
    };

    const areFiltersActive = activeFilterCount > 0;
    
    return (
        <div className="flex items-center gap-2 md:gap-4 flex-wrap md:flex-nowrap">
            {/* Title and Root Selector */}
            <div className="group flex items-center gap-1 flex-1 min-w-0">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="text-lg md:text-xl font-bold px-2 -ml-2 h-9 hover:bg-accent/50 max-w-full flex items-center gap-1">
                            <span className="truncate">{tree.title}</span>
                            <div className="flex items-center gap-1 shrink-0 px-1">
                                {tree.isPublic && (
                                    <Globe className="h-4 w-4 text-muted-foreground" />
                                )}
                                {tree.sharedWith && tree.sharedWith.length > 0 && (
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                )}
                            </div>
                            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 shrink-0" />
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
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity read-only-hidden shrink-0" onClick={() => setDialogState({ isRenameTreeOpen: true, initialTreeTitle: tree.title })}>
                        <Edit className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Search Bar */}
            {isMobile ? (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9">
                            <Search className="h-5 w-5" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[calc(100vw-2rem)] mx-4" align="center">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                autoFocus
                                type="search"
                                placeholder="Search..."
                                className="pl-9 h-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </PopoverContent>
                </Popover>
            ) : (
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search..."
                        className="pl-9 h-9 bg-muted/30 focus:bg-background transition-colors w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            )}

            {/* Filters & Favorites (Desktop) */}
            {!isMobile && (
                <div className="flex items-center gap-2 shrink-0">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className={cn("h-9", areFiltersActive && "border-primary text-primary bg-primary/5")}>
                                <Filter className={cn("mr-2 h-4 w-4", areFiltersActive && "fill-current")} />
                                Filters {areFiltersActive && `(${activeFilterCount})`}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-96" align="end">
                            {renderFilterContent()}
                        </PopoverContent>
                    </Popover>
                    
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowStarred(!showStarred)}>
                                    <Star className={cn("h-4 w-4", showStarred ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground")} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{showStarred ? 'Show All' : 'Show Favorites'} (s)</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            )}

            {/* Mobile Menu Trigger */}
            {isMobile && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon"><Menu className="h-5 w-5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onSelect={onFilterClick}>
                            <Filter className={cn("mr-2 h-4 w-4", areFiltersActive && "text-primary")} />
                            Filters {areFiltersActive && `(${activeFilterCount})`}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setShowStarred(!showStarred)}>
                            <Star className={cn("mr-2 h-4 w-4", showStarred ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground")}/>
                            Favorites
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem onClick={undoLastAction} disabled={!canUndo}>
                            <Undo2 className="mr-2 h-4 w-4" /> Undo
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={redoLastAction} disabled={!canRedo}>
                            <Redo2 className="mr-2 h-4 w-4" /> Redo
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem onSelect={() => setShowNodeOrder(!showNodeOrder)}>
                            <ListOrdered className={cn("mr-2 h-4 w-4", showNodeOrder && "text-primary")} />
                            Show Node Numbers
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setIsCompactView(!isCompactView)}>
                            {isCompactView ? <Rows className="mr-2 h-4 w-4 text-primary" /> : <Rows3 className="mr-2 h-4 w-4" />}
                            Compact View
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <Download className="mr-2 h-4 w-4" />
                                Export
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    <DropdownMenuItem onSelect={() => exportNodesAsJson(allNodes, tree.title)}><FileJson className="mr-2 h-4 w-4" />JSON</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => currentUser ? exportNodesAsArchive(allNodes, tree.title) : handlePublicExportClick()} disabled={!currentUser}><Archive className="mr-2 h-4 w-4" />Archive (.zip)</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => currentUser ? exportNodesAsHtml('tree-view-container', allNodes, tree.title) : handlePublicExportClick()} disabled={!currentUser}><FileCode className="mr-2 h-4 w-4" />HTML</DropdownMenuItem>
                                </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                        </DropdownMenuSub>
                        
                        {tree.gitSync && (
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <Github className="mr-2 h-4 w-4" />
                                    Git Sync
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuItem onClick={() => setDialogState({ isHistoryOpen: true })}><History className="mr-2 h-4 w-4" /> View History</DropdownMenuItem>
                                        <DropdownMenuItem onClick={handleSync} disabled={!isOutOfSync || isSyncing}>
                                            <GitPullRequest className="mr-2 h-4 w-4" />
                                            Sync {isOutOfSync && "(Update)"}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setDialogState({ isCommitOpen: true })}><GitCommit className="mr-2 h-4 w-4" /> Commit Changes</DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                        )}
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem onClick={() => setDialogState({ isAddNodeOpen: true })} className="read-only-hidden">
                            <PlusCircle className="mr-2 h-4 w-4" /> Add Node
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            {/* Action Buttons (Desktop) */}
            {!isMobile && (
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                    <Separator orientation="vertical" className="h-6 mx-2" />
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={undoLastAction} disabled={!canUndo}>
                                    <Undo2 className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{undoActionDescription || 'Undo'} (Ctrl+Z)</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={redoLastAction} disabled={!canRedo}>
                                    <Redo2 className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{redoActionDescription || 'Redo'} (Ctrl+Y)</p></TooltipContent>
                        </Tooltip>
                        <Separator orientation="vertical" className="h-6 mx-1" />
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowNodeOrder(!showNodeOrder)}>
                                    <ListOrdered className={cn("h-4 w-4", showNodeOrder && "text-primary")} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Show Node Numbers (o)</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setIsTwoPanelMode(!isTwoPanelMode)}>
                                    <LayoutPanelLeft className={cn("h-4 w-4", isTwoPanelMode && "text-primary")} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Two-Panel Mode (p)</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setIsCompactView(!isCompactView)}>
                                    {isCompactView ? <Rows className="h-4 w-4 text-primary" /> : <Rows3 className="h-4 w-4" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Compact View (Space)</p></TooltipContent>
                        </Tooltip>
                        <Separator orientation="vertical" className="h-6 mx-1" />
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-9 w-9">
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent><p>Export</p></TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => exportNodesAsJson(allNodes, tree.title)}><FileJson className="mr-2 h-4 w-4" />JSON</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => currentUser ? exportNodesAsArchive(allNodes, tree.title) : handlePublicExportClick()} disabled={!currentUser}><Archive className="mr-2 h-4 w-4" />Archive (.zip)</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => currentUser ? exportNodesAsHtml('tree-view-container', allNodes, tree.title) : handlePublicExportClick()} disabled={!currentUser}><FileCode className="mr-2 h-4 w-4" />HTML</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {tree.gitSync && (
                            <DropdownMenu>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-9 w-9">
                                                <Github className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Git Sync</p></TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => setDialogState({ isHistoryOpen: true })}><History className="mr-2 h-4 w-4" /> View History</DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleSync} disabled={!isOutOfSync || isSyncing}>
                                        {isSyncing ? <Loader2 className="animate-spin mr-2"/> : <GitPullRequest className="mr-2 h-4 w-4" />}
                                        Sync {isOutOfSync && "(Update Available)"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setDialogState({ isCommitOpen: true })}><GitCommit className="mr-2 h-4 w-4" /> Commit Changes</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button size="sm" onClick={() => setDialogState({ isAddNodeOpen: true })} className="ml-2 read-only-hidden h-9">
                                    <PlusCircle className="mr-2 h-4 w-4" /> Add Node
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Add root node</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            )}
        </div>
    );
}
