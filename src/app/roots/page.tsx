

/**
 * @fileoverview
 * This file defines the "Manage Roots" page.
 * This page serves as a dashboard for users to view, create, select, and delete
 * their various root structures. It is a protected route, requiring authentication.
 *
 * It displays a list of all available roots, highlighting the active one.
 * Users can initiate the creation of a new root via a dialog form and can delete
 * existing roots with a confirmation dialog.
 */
"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/header";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardFooter,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { PlusCircle, FileText, Trash2, Sparkles, Loader2, ChevronDown, Upload, Archive, Github, Link as LinkIcon, X, Plus, FileJson, Share2, Users, Search, Edit, GripVertical, Copy, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ExampleInfo, TreeFile, User } from "@/lib/types";
import { Octokit } from "octokit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";


function DraggableTreeCard({ tree, children }: { tree: TreeFile, children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tree.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="cursor-grab"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </Button>
      <div className={cn("w-full", isDragging && "opacity-50")}>
        {children}
      </div>
    </div>
  );
}


function ManageRootsPage() {
  const router = useRouter();
  const { currentUser, users } = useAuthContext();
  const {
    allTrees,
    activeTreeId,
    setActiveTreeId,
    createNewTree,
    deleteTree,
    shareTree,
    revokeShare,
    setTreePublicStatus,
    listExamples,
    loadExample,
    importTreeArchive,
    importTreeFromJson,
    linkTreeToRepo,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    isTreeDataLoading,
    setTreeTitle,
    updateTreeOrder,
  } = useTreeContext();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTreeTitle, setNewTreeTitle] = useState("");
  const [isLoadingExamples, setIsLoadingExamples] = useState(false);
  const [availableExamples, setAvailableExamples] = useState<ExampleInfo[]>([]);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [isLinkRepoOpen, setIsLinkRepoOpen] = useState(false);
  const [selectedTreeForLink, setSelectedTreeForLink] = useState<string | null>(null);
  const [userRepos, setUserRepos] = useState<any[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoIsPrivate, setNewRepoIsPrivate] = useState(true);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [selectedTreeToShare, setSelectedTreeToShare] = useState<TreeFile | null>(null);
  const [selectedUserToShare, setSelectedUserToShare] = useState("");
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [treeToRename, setTreeToRename] = useState<TreeFile | null>(null);
  const [renamedTitle, setRenamedTitle] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [orderedTrees, setOrderedTrees] = useState(allTrees);

  useEffect(() => {
    setOrderedTrees(allTrees);
  }, [allTrees]);


  const filteredTrees = useMemo(() => {
    const trees = orderedTrees || allTrees;
    if (!searchTerm) return trees;
    return trees.filter(tree => tree.title.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [allTrees, orderedTrees, searchTerm]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
  
    if (over && active.id !== over.id) {
      setOrderedTrees((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const reorderedTrees = arrayMove(items, oldIndex, newIndex);
        const updates = reorderedTrees.map((tree, index) => ({ id: tree.id, order: index }));
        updateTreeOrder(updates);
        return reorderedTrees;
      });
    }
  };


  const handleCreateTree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTreeTitle.trim()) {
      await createNewTree(newTreeTitle.trim());
      setNewTreeTitle("");
      setIsCreateDialogOpen(false);
    }
  };

  const handleDeleteTree = async (treeId: string) => {
    await deleteTree(treeId);
    if (activeTreeId === treeId) {
        router.push('/roots');
    }
  };

  const handleSelectTree = (treeId: string) => {
    setActiveTreeId(treeId);
    router.push("/");
  };
  
  const handleLoadExample = async (fileName: string) => {
    await loadExample(fileName);
    toast({
        title: "Example Loaded",
        description: "The example has been loaded as a new root."
    })
    router.push('/');
  }
  
  const handleImportArchive = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.zip')) {
      try {
        toast({ title: "Importing archive...", description: "Please wait while the data is being processed." });
        await importTreeArchive(file);
        toast({ title: "Archive Imported", description: "The archive has been successfully imported as a new root." });
      } catch (error) {
        console.error("Archive import failed:", error);
        toast({ variant: "destructive", title: "Import Failed", description: error instanceof Error ? error.message : "An unknown error occurred." });
      } finally {
        if (archiveInputRef.current) {
          archiveInputRef.current.value = "";
        }
      }
    } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please select a .zip archive file." });
    }
  };

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target?.result;
                if (typeof content !== 'string') {
                    throw new Error('File content is not valid');
                }
                const jsonData = JSON.parse(content);
                await importTreeFromJson(jsonData);
                toast({
                    title: 'Tree Imported',
                    description: 'The tree has been successfully imported from JSON.',
                });
            } catch (err) {
                const error = err as Error;
                toast({
                    variant: 'destructive',
                    title: 'Import Failed',
                    description: error.message || 'Could not read or parse the JSON file.',
                });
            } finally {
                if (jsonInputRef.current) {
                    jsonInputRef.current.value = '';
                }
            }
        };
        reader.readAsText(file);
    } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please select a .json file." });
    }
  };
  
  const handleLinkRepoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTreeForLink && selectedRepo && currentUser?.gitSettings?.githubPat) {
      const repo = userRepos.find(r => r.full_name === selectedRepo);
      if (repo) {
        setIsLinking(true);
        toast({ title: "Linking Repository...", description: `Initializing sync with ${repo.full_name}.` });
        try {
            await linkTreeToRepo(selectedTreeForLink, repo.owner.login, repo.name, repo.default_branch, currentUser.gitSettings.githubPat);
            toast({ title: "Repository Linked!", description: `Tree is now linked to ${repo.full_name}.` });
            setIsLinkRepoOpen(false);
            setSelectedTreeForLink(null);
            setSelectedRepo("");
        } catch(err) {
            const error = err as Error;
            toast({ variant: "destructive", title: "Linking Failed", description: error.message || "An unknown error occurred." });
        } finally {
            setIsLinking(false);
        }
      }
    }
  };

  useEffect(() => {
    const fetchRepos = async () => {
      if (isLinkRepoOpen && currentUser?.gitSettings?.githubPat) {
        setIsLoadingRepos(true);
        setIsTokenInvalid(false);
        try {
          const octokit = new Octokit({ auth: currentUser.gitSettings.githubPat });
          const repos = await octokit.rest.repos.listForAuthenticatedUser({
            type: 'owner',
            sort: 'updated',
            per_page: 100,
          });
          setUserRepos(repos.data);
        } catch (error) {
          console.error("Failed to fetch repositories:", error);
          setIsTokenInvalid(true);
          toast({ variant: 'destructive', title: 'Failed to fetch repos', description: 'Your GitHub token might be invalid or expired.' });
        } finally {
          setIsLoadingRepos(false);
        }
      }
    };
    fetchRepos();
  }, [isLinkRepoOpen, currentUser?.gitSettings?.githubPat, toast]);
  
  const handleCreateAndLinkRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTreeForLink || !newRepoName.trim() || !currentUser?.gitSettings?.githubPat) {
        toast({ variant: "destructive", title: "Missing Information", description: "Please provide a repository name and ensure your PAT is set." });
        return;
    }
    setIsCreatingRepo(true);
    try {
        await createAndLinkTreeToRepo(selectedTreeForLink, newRepoName, newRepoIsPrivate, currentUser.gitSettings.githubPat);
        toast({ title: "Repository Created & Linked!", description: `Successfully created and linked repository.` });
        setIsLinkRepoOpen(false);
        setNewRepoName("");
    } catch(err) {
        const error = err as Error;
        toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
        setIsCreatingRepo(false);
    }
  };
  
  const handleUnlink = async (treeId: string) => {
    await unlinkTreeFromRepo(treeId);
    toast({ title: "Repository Unlinked", description: "The tree is no longer synced with GitHub." });
  };

  const handleShare = async () => {
    if (selectedTreeToShare && selectedUserToShare) {
        await shareTree(selectedTreeToShare.id, selectedUserToShare);
        setIsShareDialogOpen(false);
        setSelectedTreeToShare(null);
        setSelectedUserToShare("");
    }
  };

  const revokeShareAndClose = async (treeId: string, userId: string) => {
    await revokeShare(treeId, userId);
  };

  const handlePublicToggle = async (treeId: string, isPublic: boolean) => {
    await setTreePublicStatus(treeId, isPublic);
    // Optimistically update local state for immediate feedback in the dialog
    setSelectedTreeToShare(prev => prev ? { ...prev, isPublic } : null);
  };
  
  const handleCopyPublicLink = (treeId: string) => {
    const url = `${window.location.origin}/view/${treeId}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link Copied", description: "Public link copied to clipboard." });
  };
  
  const handleRenameTree = (e: React.FormEvent) => {
    e.preventDefault();
    if (treeToRename && renamedTitle.trim()) {
        setTreeTitle(treeToRename.id, renamedTitle.trim());
        toast({ title: "Renamed", description: `Tree renamed to "${renamedTitle.trim()}".` });
        setIsRenameDialogOpen(false);
        setTreeToRename(null);
        setRenamedTitle("");
    }
  };
  
  const renderContent = () => {
    if (isTreeDataLoading) {
      return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(3)].map((_, i) => (
             <Card key={i} className="flex flex-col">
                  <CardHeader>
                      <div className="h-6 bg-muted rounded w-3/4 animate-pulse"></div>
                      <div className="h-4 bg-muted rounded w-1/2 animate-pulse mt-1"></div>
                  </CardHeader>
                  <CardContent className="flex-grow space-y-2">
                     <div className="h-4 bg-muted rounded w-full animate-pulse"></div>
                  </CardContent>
                  <CardFooter className="flex justify-between items-center bg-muted/50 p-3 mt-4">
                     <div className="h-10 bg-muted rounded w-20 animate-pulse"></div>
                  </CardFooter>
                </Card>
          ))}
        </div>
      );
    }

    if (allTrees.length === 0) {
        return (
            <Card className="col-span-full flex flex-col items-center justify-center h-64 border-dashed">
                <div className="text-center">
                  <h3 className="text-lg font-semibold">No Roots Found</h3>
                  <p className="text-muted-foreground">
                    Get started by creating your first root.
                  </p>
                </div>
              </Card>
        );
    }

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={filteredTrees.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredTrees.map((tree: TreeFile) => {
              const owner = users.find(u => u.id === tree.userId);
              const isOwner = currentUser?.id === tree.userId;

              const sharedWithUsers = (tree.sharedWith || [])
                  .map(id => users.find(u => u.id === id))
                  .filter((u): u is User => !!u);

              return (
              <DraggableTreeCard key={tree.id} tree={tree}>
              <Card
                className={`flex flex-col hover:shadow-lg transition-shadow ${
                  tree.id === activeTreeId ? "border-primary" : ""
                }`}
              >
                <CardHeader>
                  <CardTitle className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-primary" /> {tree.title}
                      </div>
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTreeToRename(tree);
                            setRenamedTitle(tree.title);
                            setIsRenameDialogOpen(true);
                          }}>
                           <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive h-7 w-7" disabled={!isOwner && allTrees.length <= 1}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {isOwner 
                                      ? `This will permanently delete the "${tree.title}" root and all its content. This action cannot be undone.`
                                      : `This will remove the shared tree "${tree.title}" from your list. It will not be deleted for the owner.`
                                  }
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteTree(tree.id)} className="bg-destructive hover:bg-destructive/90">
                                  {isOwner ? 'Delete' : 'Remove'}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                  </CardTitle>
                  <CardDescription>
                    <p>{tree.tree.length} root node{tree.tree.length !== 1 ? 's' : ''}</p>
                    {!isOwner && owner && <p className="text-xs">Owned by {owner.username}</p>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-2">
                   {tree.isPublic && (
                        <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/50 flex items-center gap-2">
                            <Globe className="h-4 w-4 shrink-0" />
                            <span>Public</span>
                        </div>
                    )}
                   {tree.gitSync && (
                      <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/50 flex items-center justify-between">
                          <div className="flex items-center gap-2 overflow-hidden">
                              <Github className="h-4 w-4 shrink-0" />
                              <span className="truncate">{tree.gitSync.repoOwner}/{tree.gitSync.repoName}</span>
                          </div>
                           {isOwner && (
                              <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => handleUnlink(tree.id)}>
                                  <X className="h-3 w-3" />
                              </Button>
                          )}
                      </div>
                   )}
                  {isOwner && sharedWithUsers.length > 0 && (
                    <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/50 space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                          <Users className="h-4 w-4 shrink-0" />
                          <span>Shared with:</span>
                      </div>
                      {sharedWithUsers.map(user => (
                        <div key={user.id} className="flex items-center justify-between pl-2">
                          <span>- {user.username}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => revokeShare(tree.id, user.id)}>
                              <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex justify-between items-center bg-muted/50 p-3 mt-4">
                  <Button
                    onClick={() => handleSelectTree(tree.id)}
                    disabled={tree.id === activeTreeId}
                  >
                    {tree.id === activeTreeId ? "Active" : "Open"}
                  </Button>
                  <div className="flex gap-2">
                      {isOwner && (
                          <Button variant="outline" size="sm" onClick={() => { setSelectedTreeToShare(tree); setIsShareDialogOpen(true); }}>
                              <Share2 className="mr-2 h-4 w-4" />
                              Share
                          </Button>
                      )}
                      {!tree.gitSync && isOwner && (
                          <Button variant="outline" size="sm" onClick={() => { setSelectedTreeForLink(tree.id); setIsLinkRepoOpen(true); }} disabled={!currentUser?.gitSettings?.githubPat}>
                              <LinkIcon className="mr-2 h-4 w-4" />
                              Link
                          </Button>
                      )}
                  </div>
                </CardFooter>
              </Card>
            </DraggableTreeCard>
            )})}
          </div>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-muted/20">
        <AppHeader />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4 md:py-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h1 className="text-3xl font-bold">Manage Roots</h1>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search roots..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row justify-end items-center mb-6 gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                          <Upload className="mr-2 h-4 w-4" /> Import <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => jsonInputRef.current?.click()}>
                          <FileJson className="mr-2 h-4 w-4" />
                          Import from JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => archiveInputRef.current?.click()}>
                          <Archive className="mr-2 h-4 w-4" />
                          Import from Archive
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                 <input
                    type="file"
                    ref={jsonInputRef}
                    onChange={handleImportJson}
                    accept=".json"
                    className="hidden"
                />
                 <input
                    type="file"
                    ref={archiveInputRef}
                    onChange={handleImportArchive}
                    accept=".zip"
                    className="hidden"
                />

                <DropdownMenu onOpenChange={async (open) => {
                  if (open && availableExamples.length === 0) {
                      setIsLoadingExamples(true);
                      try {
                          const examples = await listExamples();
                          setAvailableExamples(examples);
                      } catch (error) {
                          toast({ variant: "destructive", title: "Error", description: "Could not load examples." });
                      } finally {
                          setIsLoadingExamples(false);
                      }
                  }
                }}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={isLoadingExamples}>
                      {isLoadingExamples ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4" />}
                      Load Example
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {availableExamples.length > 0 ? availableExamples.map((example) => (
                      <DropdownMenuItem key={example.fileName} onSelect={() => handleLoadExample(example.fileName)}>
                        {example.title}
                      </DropdownMenuItem>
                    )) : (
                       <DropdownMenuItem disabled>No examples found</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Dialog
                  open={isCreateDialogOpen}
                  onOpenChange={setIsCreateDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button>
                      <PlusCircle className="mr-2 h-4 w-4" /> Create New Root
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <form onSubmit={handleCreateTree}>
                      <DialogHeader>
                        <DialogTitle>Create a New Root</DialogTitle>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="tree-title" className="text-right">
                            Title
                          </Label>
                          <Input
                            id="tree-title"
                            value={newTreeTitle}
                            onChange={(e) => setNewTreeTitle(e.target.value)}
                            className="col-span-3"
                            placeholder="e.g., My Novel Outline"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="ghost">
                            Cancel
                          </Button>
                        </DialogClose>
                        <Button type="submit">Create</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
          </div>
          
          {renderContent()}
          
          <Dialog open={isLinkRepoOpen} onOpenChange={setIsLinkRepoOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Link to GitHub Repository</DialogTitle>
                </DialogHeader>
                 <Tabs defaultValue="select" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="select"><Github className="mr-2 h-4 w-4"/>Select Existing</TabsTrigger>
                    <TabsTrigger value="create"><Plus className="mr-2 h-4 w-4"/>Create New</TabsTrigger>
                  </TabsList>
                  <TabsContent value="select">
                    <form onSubmit={handleLinkRepoSubmit} className="space-y-4 pt-4">
                        {isLoadingRepos ? (
                            <div className="flex items-center justify-center h-24">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                        ) : (
                            <div className="space-y-2">
                               <Label htmlFor="repo-select">Select a Repository</Label>
                               <Select onValueChange={setSelectedRepo} value={selectedRepo}>
                                    <SelectTrigger id="repo-select">
                                        <SelectValue placeholder="Choose a repository..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {userRepos.map(repo => (
                                            <SelectItem key={repo.id} value={repo.full_name}>
                                                <div className="flex items-center gap-2">
                                                    <Github className="h-4 w-4" />
                                                    <span>{repo.full_name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                               </Select>
                            </div>
                        )}
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={!selectedRepo || isLoadingRepos || isLinking}>
                               {isLinking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Link Repository
                            </Button>
                        </DialogFooter>
                    </form>
                  </TabsContent>
                  <TabsContent value="create">
                    <form onSubmit={handleCreateAndLinkRepo} className="space-y-4 pt-4">
                        <div className="space-y-2">
                            <Label htmlFor="new-repo-name">Repository Name</Label>
                            <Input 
                                id="new-repo-name"
                                value={newRepoName}
                                onChange={(e) => setNewRepoName(e.target.value)}
                                placeholder="e.g., my-tree-data"
                                required
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch 
                                id="private-repo" 
                                checked={newRepoIsPrivate}
                                onCheckedChange={setNewRepoIsPrivate}
                            />
                            <Label htmlFor="private-repo">Create as private repository</Label>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={!newRepoName || isCreatingRepo}>
                                {isCreatingRepo && <Loader2 className="animate-spin mr-2" />}
                                Create and Link
                            </Button>
                        </DialogFooter>
                    </form>
                  </TabsContent>
                </Tabs>
            </DialogContent>
          </Dialog>

          <Dialog open={isShareDialogOpen} onOpenChange={(open) => {
              if (!open) setSelectedTreeToShare(null);
              setIsShareDialogOpen(open);
          }}>
              <DialogContent>
                  <DialogHeader>
                      <DialogTitle>Share "{selectedTreeToShare?.title}"</DialogTitle>
                  </DialogHeader>
                  <div className="py-4 space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-medium">Private Sharing</h4>
                      <p className="text-sm text-muted-foreground">Grant edit access to specific users.</p>
                      <div className="flex gap-2">
                        <Select onValueChange={setSelectedUserToShare} value={selectedUserToShare}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a user..."/>
                            </SelectTrigger>
                            <SelectContent>
                                {users.filter(u => u.id !== currentUser?.id && !(selectedTreeToShare?.sharedWith || []).includes(u.id)).map(user => (
                                    <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button onClick={handleShare} disabled={!selectedUserToShare}>Add User</Button>
                      </div>
                      {(selectedTreeToShare?.sharedWith?.length || 0) > 0 && (
                          <div className="space-y-2 pt-2">
                              <Label>Current Collaborators</Label>
                               {(selectedTreeToShare?.sharedWith || []).map(userId => {
                                   const user = users.find(u => u.id === userId);
                                   return user ? (
                                    <div key={userId} className="flex items-center justify-between text-sm p-2 bg-muted rounded-md">
                                        <span>{user.username}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => revokeShareAndClose(selectedTreeToShare!.id, userId)}>
                                            <X className="h-4 w-4"/>
                                        </Button>
                                    </div>
                                   ) : null;
                               })}
                          </div>
                      )}
                    </div>
                     <div className="space-y-4 pt-4 border-t">
                      <h4 className="font-medium">Public Sharing</h4>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="public-switch">Make Public</Label>
                            <p className="text-xs text-muted-foreground">Anyone with the link can view this tree.</p>
                        </div>
                         <Switch
                            id="public-switch"
                            checked={selectedTreeToShare?.isPublic || false}
                            onCheckedChange={(checked) => handlePublicToggle(selectedTreeToShare!.id, checked)}
                        />
                      </div>
                      {selectedTreeToShare?.isPublic && (
                         <div className="flex gap-2">
                            <Input readOnly value={`${window.location.origin}/view/${selectedTreeToShare.id}`} />
                            <Button variant="outline" onClick={() => handleCopyPublicLink(selectedTreeToShare!.id)}>
                                <Copy className="mr-2 h-4 w-4" /> Copy Link
                            </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                      <DialogClose asChild><Button variant="outline">Done</Button></DialogClose>
                  </DialogFooter>
              </DialogContent>
          </Dialog>

          <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
              <DialogContent>
                  <form onSubmit={handleRenameTree}>
                      <DialogHeader>
                          <DialogTitle>Rename Tree</DialogTitle>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                          <Label htmlFor="rename-title">New Title</Label>
                          <Input
                              id="rename-title"
                              value={renamedTitle}
                              onChange={(e) => setRenamedTitle(e.target.value)}
                              placeholder="Enter new tree title"
                          />
                      </div>
                      <DialogFooter>
                          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                          <Button type="submit">Rename</Button>
                      </DialogFooter>
                  </form>
              </DialogContent>
          </Dialog>

        </main>
      </div>
    </ProtectedRoute>
  );
}

export default ManageRootsPage;
