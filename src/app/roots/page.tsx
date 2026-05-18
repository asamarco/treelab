/**
 * @fileoverview
 * This file defines the "Manage Roots" page.
 */
"use client";

import { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
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
import { PlusCircle, FileText, Trash2, Sparkles, Loader2, ChevronDown, Upload, Archive, Github, Link as LinkIcon, X, Plus, FileJson, Share2, Users, Search, Edit, GripVertical, Copy, Globe, CopyPlus, ShieldCheck, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ExampleInfo, TreeFile, TreePermissions, TreeShare, User } from "@/lib/types";
import { searchUsers } from "@/lib/auth-client";
import { Octokit } from "octokit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateJsonForExport } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


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
    <div ref={setNodeRef} style={style} className="flex h-full w-full items-stretch gap-2 transition-opacity">
      <div className="flex items-center shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="cursor-grab hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </Button>
      </div>
      <div className={cn("flex-1 min-w-0 w-full flex flex-col", isDragging && "opacity-50")}>
        {children}
      </div>
    </div>
  );
}


function DroppableFilterPill({ id, isActive, onClick, title, isGroupingPill }: { id: string, isActive: boolean, onClick: () => void, title: string, isGroupingPill: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !isGroupingPill });
  return (
    <Button
      ref={setNodeRef}
      variant={isActive ? "default" : "outline"}
      onClick={onClick}
      className={cn(
        "rounded-full shrink-0 transition-all",
        isOver && "ring-2 ring-primary ring-offset-2 scale-105"
      )}
    >
      {title}
    </Button>
  );
}


function ManageRootsPage() {
  const router = useRouter();
  const { currentUser, users, setTreeSettings, setCustomGroups } = useAuthContext();
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
    duplicateTree,
    userTeams,
    shareTreeWithTeam,
    revokeShareFromTeam,
  } = useTreeContext();
  const { toast } = useToast();
  const dndContextId = useId();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTreeTitle, setNewTreeTitle] = useState("");
  const [newTreeGroup, setNewTreeGroup] = useState("Ungrouped");
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
  const [editedGroup, setEditedGroup] = useState<string>("Ungrouped");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeGroupFilter, setActiveGroupFilter] = useState("All Roots");
  const [isManageGroupsOpen, setIsManageGroupsOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState("");
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [orderedTrees, setOrderedTrees] = useState(allTrees);
  const [selectedViewMode, setSelectedViewMode] = useState<string>("standard");
  const [selectedExplorerMode, setSelectedExplorerMode] = useState<boolean>(false);
  const [sharePermissions, setSharePermissions] = useState<TreePermissions>({
    editNodes: false,
    editTemplates: false,
    admin: false,
  });
  const [editingShareUserId, setEditingShareUserId] = useState<string | null>(null);
  const [editingSharePermissions, setEditingSharePermissions] = useState<TreePermissions>({
    editNodes: false,
    editTemplates: false,
    admin: false,
  });
  const [selectedTeamToShare, setSelectedTeamToShare] = useState("");
  const [teamSharePermissions, setTeamSharePermissions] = useState<TreePermissions>({
    editNodes: false,
    editTemplates: false,
    admin: false,
  });
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<{ id: string, username: string }[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  useEffect(() => {
    setOrderedTrees(allTrees);
  }, [allTrees]);

  useEffect(() => {
    if (selectedTreeToShare) {
      const updatedTree = allTrees.find(t => t.id === selectedTreeToShare.id);
      if (updatedTree && (
        JSON.stringify(updatedTree.shares) !== JSON.stringify(selectedTreeToShare.shares) ||
        JSON.stringify(updatedTree.sharedWith) !== JSON.stringify(selectedTreeToShare.sharedWith) ||
        JSON.stringify(updatedTree.teamShares) !== JSON.stringify(selectedTreeToShare.teamShares)
      )) {
        setSelectedTreeToShare(updatedTree);
      }
    }
  }, [allTrees, selectedTreeToShare]);

  useEffect(() => {
    const search = async () => {
      if (userSearchQuery.length < 2) {
        setUserSearchResults([]);
        return;
      }
      setIsSearchingUsers(true);
      try {
        const results = await searchUsers(userSearchQuery);
        // Filter out already shared users and current user
        const filtered = results.filter(u => {
          if (u.id === currentUser?.id) return false;
          if ((selectedTreeToShare?.sharedWith || []).includes(u.id)) return false;
          if ((selectedTreeToShare?.shares || []).some(s => s.userId === u.id)) return false;
          return true;
        });
        setUserSearchResults(filtered);
      } catch (err) {
        console.error("User search failed", err);
      } finally {
        setIsSearchingUsers(false);
      }
    };

    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [userSearchQuery, currentUser?.id, selectedTreeToShare]);


  const filteredTrees = useMemo(() => {
    const trees = orderedTrees || allTrees;
    if (!searchTerm) return trees;
    return trees.filter(tree => tree.title.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [allTrees, orderedTrees, searchTerm]);

  const viewingTrees = useMemo(() => {
    const treeSettings = currentUser?.treeSettings || [];
    
    let result = filteredTrees;
    
    if (activeGroupFilter !== "All Roots") {
      result = filteredTrees.filter(tree => {
        const setting = treeSettings.find(s => s.treeId === tree.id);
        const groupName = setting?.groupName || "Ungrouped";
        return groupName === activeGroupFilter;
      });
    }

    result.sort((a, b) => {
        const orderA = treeSettings.find(s => s.treeId === a.id)?.order ?? (a as any).order ?? 0;
        const orderB = treeSettings.find(s => s.treeId === b.id)?.order ?? (b as any).order ?? 0;
        return orderA - orderB;
    });

    return result;
  }, [filteredTrees, currentUser?.treeSettings, activeGroupFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    if (activeId === overId) return;

    const currentSettings = [...(currentUser?.treeSettings || [])];
    let treeSetting = currentSettings.find(s => s.treeId === activeId);
    let activeTreeGroup = treeSetting?.groupName || "Ungrouped";

    // Dropped onto a Filter Pill
    if (overId.startsWith("group-pill-")) {
      const targetGroupName = overId.replace("group-pill-", "");
      if (activeTreeGroup === targetGroupName) return; // already in this group
      
      if (!treeSetting) {
          treeSetting = { treeId: activeId, groupName: targetGroupName, order: 0 };
          currentSettings.push(treeSetting);
      } else {
          treeSetting.groupName = targetGroupName;
      }

      if (setTreeSettings) {
          setTreeSettings(currentSettings);
          toast({ title: "Moved", description: `Root moved to ${targetGroupName}` });
      }
      return;
    }

    // Otherwise, dropping onto another tree card for reordering
    // We only allow reordering if the user is viewing a specific group (or All Roots, which orders globally within groups... wait, usually users sort within a specific group view).
    // For simplicity, we just sort the `viewingTrees` array.
    const oldIndex = viewingTrees.findIndex(t => t.id === activeId);
    const newIndex = viewingTrees.findIndex(t => t.id === overId);
    if (oldIndex !== -1 && newIndex !== -1) {
      const newArray = arrayMove(viewingTrees, oldIndex, newIndex);
      newArray.forEach((t, i) => {
          let s = currentSettings.find(cs => cs.treeId === t.id);
          if (!s) {
              s = { treeId: t.id, groupName: activeTreeGroup, order: i };
              currentSettings.push(s);
          } else {
              s.order = i;
          }
      });
      if (setTreeSettings) {
          setTreeSettings(currentSettings);
      }
    }
  };


  const handleAddGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const currentGroups = currentUser?.customGroups || [];
    if (setCustomGroups && newGroupName.trim() && !currentGroups.includes(newGroupName.trim())) {
      setCustomGroups([...currentGroups, newGroupName.trim()]);
    }
    setNewGroupName("");
  };


  const handleCreateTree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTreeTitle.trim()) {
      const treeId = await createNewTree(newTreeTitle.trim());
      if (treeId) {
          const currentSettings = [...(currentUser?.treeSettings || [])];
          let treeSetting = currentSettings.find(s => s.treeId === treeId);
          if (!treeSetting) {
              treeSetting = { treeId, groupName: newTreeGroup, order: currentSettings.length };
              currentSettings.push(treeSetting);
          } else {
              treeSetting.groupName = newTreeGroup;
          }
          if (setTreeSettings) {
              setTreeSettings(currentSettings);
          }
      }
      setNewTreeTitle("");
      setNewTreeGroup("Ungrouped");
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
        } catch (err) {
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
    } catch (err) {
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
      await shareTree(selectedTreeToShare.id, selectedUserToShare, sharePermissions);
      setSelectedUserToShare("");
      setUserSearchQuery("");
      setSharePermissions({ editNodes: false, editTemplates: false, admin: false });
    }
  };

  const saveEditingShare = async () => {
    if (selectedTreeToShare && editingShareUserId) {
      await shareTree(selectedTreeToShare.id, editingShareUserId, editingSharePermissions);
      setEditingShareUserId(null);
    }
  };

  const revokeShareAndClose = async (treeId: string, userId: string) => {
    await revokeShare(treeId, userId);
  };

  const handleShareTeam = async () => {
    if (!selectedTreeToShare || !selectedTeamToShare) return;
    await shareTreeWithTeam(selectedTreeToShare.id, selectedTeamToShare, teamSharePermissions);
    setSelectedTeamToShare("");
    setTeamSharePermissions({ editNodes: false, editTemplates: false, admin: false });
  };

  const revokeShareFromTeamAndClose = async (treeId: string, teamId: string) => {
    await revokeShareFromTeam(treeId, teamId);
  };

  const handlePublicToggle = async (treeId: string, isPublic: boolean) => {
    const publicId = await setTreePublicStatus(treeId, isPublic);
    setSelectedTreeToShare(prev => prev ? { ...prev, isPublic, publicId: publicId ?? prev.publicId } : null);
  };

  const getPublicUrl = (tree: TreeFile) => {
    const identifier = tree.publicId || tree.id;
    let url = `${window.location.origin}/view/${identifier}`;
    const params = new URLSearchParams();
    if (selectedViewMode !== 'standard') {
      params.append('view', selectedViewMode);
    }
    if (selectedExplorerMode) {
      params.append('explorer', 'true');
    }
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    return url;
  }

  const handleCopyPublicLink = (treeId: string) => {
    const tree = allTrees.find(t => t.id === treeId);
    if (!tree) return;
    const url = getPublicUrl(tree);
    navigator.clipboard.writeText(url);
    toast({ title: "Link Copied", description: "Public link copied to clipboard." });
  };

  const handleRenameTree = (e: React.FormEvent) => {
    e.preventDefault();
    if (treeToRename) {
      const isOwner = currentUser?.id === treeToRename.userId;
      const isAdmin = treeToRename.shares?.some(s => s.userId === currentUser?.id && s.permissions.admin) ?? false;
      const canRename = isOwner || isAdmin;

      if (canRename && renamedTitle.trim() && renamedTitle.trim() !== treeToRename.title) {
        setTreeTitle(treeToRename.id, renamedTitle.trim());
      }

      const currentSettings = [...(currentUser?.treeSettings || [])];
      let treeSetting = currentSettings.find(s => s.treeId === treeToRename.id);
      if (!treeSetting) {
          treeSetting = { treeId: treeToRename.id, groupName: editedGroup, order: 0 };
          currentSettings.push(treeSetting);
      } else {
          treeSetting.groupName = editedGroup;
      }
      if (setTreeSettings) {
          setTreeSettings(currentSettings);
      }

      toast({ title: "Updated", description: `Tree settings saved.` });
      setIsRenameDialogOpen(false);
      setTreeToRename(null);
      setRenamedTitle("");
      setEditedGroup("Ungrouped");
    }
  };

  const handleDeleteGroup = (groupName: string) => {
    if (groupName === "Ungrouped") return;
    
    // 1. Remove from customGroups
    const newCustomGroups = (currentUser?.customGroups || []).filter(g => g !== groupName);
    if (setCustomGroups) setCustomGroups(newCustomGroups);
    
    // 2. Move trees to Ungrouped in settings
    const currentSettings = [...(currentUser?.treeSettings || [])];
    const newSettings = currentSettings.map(s => 
      s.groupName === groupName ? { ...s, groupName: "Ungrouped" } : s
    );
    if (setTreeSettings) setTreeSettings(newSettings);
    
    // 3. Reset local state
    setEditedGroup("Ungrouped");
    if (activeGroupFilter === groupName) {
      setActiveGroupFilter("All Roots");
    }
    
    toast({ title: "Group Removed", description: `The group "${groupName}" was deleted and its roots moved to Ungrouped.` });
  };

  const handleRenameGroup = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      setEditingGroupName(null);
      return;
    }
    
    // 1. Update customGroups
    const newCustomGroups = (currentUser?.customGroups || []).map(g => g === oldName ? newName.trim() : g);
    if (setCustomGroups) setCustomGroups(newCustomGroups);
    
    // 2. Update all treeSettings using this group
    const currentSettings = [...(currentUser?.treeSettings || [])];
    const newSettings = currentSettings.map(s => 
      s.groupName === oldName ? { ...s, groupName: newName.trim() } : s
    );
    if (setTreeSettings) setTreeSettings(newSettings);
    
    // 3. Update active filter if needed
    if (activeGroupFilter === oldName) {
      setActiveGroupFilter(newName.trim());
    }

    setEditingGroupName(null);
    toast({ title: "Group Renamed", description: `Group "${oldName}" is now "${newName.trim()}".` });
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

    const allCustomGroups = currentUser?.customGroups || [];
    const treeSettings = currentUser?.treeSettings || [];
    const ungroupedTreesCount = filteredTrees.filter(tree => {
      const s = treeSettings.find(st => st.treeId === tree.id);
      return !s || s.groupName === "Ungrouped";
    }).length;

    // Auto-reset filter if searching/deleting makes it empty
    if (activeGroupFilter === "Ungrouped" && ungroupedTreesCount === 0 && filteredTrees.length > 0) {
      setActiveGroupFilter("All Roots");
    }
    
    return (
      <DndContext id={dndContextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex w-full overflow-x-auto pb-4 gap-2 mb-4 scrollbar-hide">
          <DroppableFilterPill 
            id="group-pill-All Roots" 
            isActive={activeGroupFilter === "All Roots"} 
            onClick={() => setActiveGroupFilter("All Roots")} 
            title="All Roots"
            isGroupingPill={false}
          />
          {ungroupedTreesCount > 0 && (
            <DroppableFilterPill 
              id="group-pill-Ungrouped" 
              isActive={activeGroupFilter === "Ungrouped"} 
              onClick={() => setActiveGroupFilter("Ungrouped")} 
              title="Ungrouped"
              isGroupingPill={true}
            />
          )}
          {allCustomGroups.map(g => {
            const groupCount = filteredTrees.filter(tree => {
              const s = treeSettings.find(st => st.treeId === tree.id);
              return s?.groupName === g;
            }).length;
            
            return (
              <DroppableFilterPill 
                key={`group-pill-${g}`}
                id={`group-pill-${g}`}
                isActive={activeGroupFilter === g} 
                onClick={() => setActiveGroupFilter(g)} 
                title={`${g}${groupCount > 0 ? ` (${groupCount})` : ''}`}
                isGroupingPill={true}
              />
            );
          })}
        </div>

        <SortableContext items={viewingTrees.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 w-full h-full">
            {viewingTrees.map((tree: TreeFile) => {
              const owner = tree.owner || users.find(u => u.id === tree.userId);
              const isOwner = currentUser?.id === tree.userId;
              const isAdmin = tree.shares?.some(s => s.userId === currentUser?.id && s.permissions.admin) ?? false;
              const canManageTree = isOwner || isAdmin;
              const hasWritePerms = isOwner || isAdmin || (tree.shares?.some(s => s.userId === currentUser?.id && (s.permissions.editNodes || s.permissions.editTemplates)) ?? false);

              const sharedWithUsers = (tree.sharedWith || [])
                .map(id => users.find(u => u.id === id))
                .filter((u): u is User => !!u);

              return (
                <DraggableTreeCard key={tree.id} tree={tree}>
                  <Card
                    className={`flex flex-col hover:shadow-lg transition-shadow ${tree.id === activeTreeId ? "border-primary" : ""
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
                              const currentGroup = currentUser?.treeSettings?.find(s => s.treeId === tree.id)?.groupName || "Ungrouped";
                              setEditedGroup(currentGroup);
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
                        {!isOwner && owner && <p className="text-xs text-muted-foreground">Owned by {owner.username}</p>}
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
                          {hasWritePerms && (
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => handleUnlink(tree.id)}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                      {isOwner && ((tree.sharedWith && tree.sharedWith.length > 0) || (tree.shares && tree.shares.length > 0)) && (
                        <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/50 space-y-1">
                          <div className="flex items-center gap-2 font-medium">
                            <Users className="h-4 w-4 shrink-0" />
                            <span>Shared with:</span>
                          </div>
                          {/* Legacy sharedWith users (read-only) */}
                          {(tree.sharedWith || []).map(uid => {
                            const user = users.find(u => u.id === uid);
                            return user ? (
                              <div key={uid} className="flex items-center justify-between pl-2">
                                <span>- {user.username} <span className="text-muted-foreground/60">(read-only)</span></span>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => revokeShare(tree.id, uid)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : null;
                          })}
                          {/* New shares with permissions */}
                          {(tree.shares || []).map(share => {
                            const user = share.user || users.find(u => u.id === share.userId);
                            const permLabels = [];
                            if (share.permissions.admin) permLabels.push('admin');
                            else {
                              if (share.permissions.editNodes) permLabels.push('nodes');
                              if (share.permissions.editTemplates) permLabels.push('templates');
                            }
                            const label = permLabels.length > 0 ? permLabels.join(', ') : 'read-only';
                            return user ? (
                              <div key={share.userId} className="flex items-center justify-between pl-2">
                                <span>- {user.username} <span className="text-muted-foreground/60">({label})</span></span>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => revokeShare(tree.id, share.userId)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : null;
                          })}
                        </div>
                      )}

                      {(tree.teamShares && tree.teamShares.length > 0) && (
                        <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/50 space-y-1">
                          <div className="flex items-center gap-2 font-medium">
                            <ShieldCheck className="h-4 w-4 shrink-0" />
                            <span>Shared with Teams:</span>
                          </div>
                          {tree.teamShares.map(ts => {
                            const team = userTeams.find(t => t.id === ts.teamId);
                            const permLabels = [];
                            if (ts.permissions.admin) permLabels.push('admin');
                            else {
                              if (ts.permissions.editNodes) permLabels.push('nodes');
                              if (ts.permissions.editTemplates) permLabels.push('templates');
                            }
                            const label = permLabels.length > 0 ? permLabels.join(', ') : 'read-only';
                            return (
                              <div key={ts.teamId} className="flex items-center justify-between pl-2">
                                <span>- {team?.name || 'Unknown Team'} <span className="text-muted-foreground/60">({label})</span></span>
                                {isOwner && (
                                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => revokeShareFromTeam(tree.id, ts.teamId)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            );
                          })}
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
                      <div className="flex gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="outline" size="icon" onClick={() => duplicateTree(tree.id)}>
                                <CopyPlus className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Duplicate Tree</p></TooltipContent>
                          </Tooltip>
                          {canManageTree && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" onClick={() => { setSelectedTreeToShare(tree); setIsShareDialogOpen(true); }}>
                                  <Share2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Share Tree</p></TooltipContent>
                            </Tooltip>
                          )}
                          {!tree.gitSync && hasWritePerms && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" onClick={() => { setSelectedTreeForLink(tree.id); setIsLinkRepoOpen(true); }} disabled={!currentUser?.gitSettings?.githubPat}>
                                  <Github className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Link to GitHub</p></TooltipContent>
                            </Tooltip>
                          )}
                        </TooltipProvider>
                      </div>
                    </CardFooter>
                  </Card>
                </DraggableTreeCard>
              )
            })}
          </div>
        </SortableContext>
        {viewingTrees.length === 0 && (
           <div className="mt-8 col-span-full min-h-[150px] flex flex-col items-center justify-center text-muted-foreground/50 border-2 border-dashed border-muted-foreground/20 rounded-xl w-full">
              <p className="text-lg">No roots here</p>
              <p className="text-sm">Drag roots onto the filter buttons above to assign them</p>
           </div>
        )}
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
                  {isLoadingExamples ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
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

            <Dialog open={isManageGroupsOpen} onOpenChange={setIsManageGroupsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" /> Groups
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Manage Groups</DialogTitle>
                  <DialogDescription>Create, rename, or delete your custom root categories.</DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="flex gap-2">
                    <Input 
                      placeholder="New group name..." 
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddGroup(e)}
                    />
                    <Button onClick={handleAddGroup} disabled={!newGroupName.trim()}>Add</Button>
                  </div>

                  <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
                    {(currentUser?.customGroups || []).length === 0 && (
                      <div className="p-8 text-center text-muted-foreground text-sm">
                        No custom groups yet.
                      </div>
                    )}
                    {(currentUser?.customGroups || []).map(group => (
                      <div key={group} className="p-3 flex items-center justify-between group">
                        {editingGroupName === group ? (
                          <div className="flex flex-1 gap-2 mr-2">
                            <Input 
                              autoFocus
                              value={editingGroupValue}
                              onChange={(e) => setEditingGroupValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleRenameGroup(group, editingGroupValue)}
                              onBlur={() => setEditingGroupName(null)}
                            />
                            <Button size="sm" onClick={() => handleRenameGroup(group, editingGroupValue)}>Save</Button>
                          </div>
                        ) : (
                          <>
                            <span className="font-medium">{group}</span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8"
                                onClick={() => {
                                  setEditingGroupName(group);
                                  setEditingGroupValue(group);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteGroup(group)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Close</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

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
                    <div className="space-y-2">
                      <Label htmlFor="tree-title">Title</Label>
                      <Input
                        id="tree-title"
                        value={newTreeTitle}
                        onChange={(e) => setNewTreeTitle(e.target.value)}
                        placeholder="e.g., My Novel Outline"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-tree-group">Group</Label>
                      <Select value={newTreeGroup} onValueChange={setNewTreeGroup}>
                        <SelectTrigger id="new-tree-group">
                          <SelectValue placeholder="Select a group" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Ungrouped">Ungrouped</SelectItem>
                          {(currentUser?.customGroups || []).map(g => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  <TabsTrigger value="select"><Github className="mr-2 h-4 w-4" />Select Existing</TabsTrigger>
                  <TabsTrigger value="create"><Plus className="mr-2 h-4 w-4" />Create New</TabsTrigger>
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
            if (!open) {
              setSelectedTreeToShare(null);
              setSelectedViewMode("standard");
              setSelectedExplorerMode(false);
              setEditingShareUserId(null);
            }
            setIsShareDialogOpen(open);
          }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Share "{selectedTreeToShare?.title}"</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="people" className="py-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="people">People</TabsTrigger>
                  <TabsTrigger value="teams">Teams</TabsTrigger>
                </TabsList>
                
                <TabsContent value="people" className="space-y-6 mt-4">
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Grant access to specific users.</p>
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search colleagues to share with..."
                          className="pl-10"
                          value={userSearchQuery}
                          onChange={(e) => setUserSearchQuery(e.target.value)}
                        />
                        {isSearchingUsers && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      
                      {userSearchResults.length > 0 && (
                        <div className="border rounded-md shadow-sm bg-popover max-h-48 overflow-y-auto">
                          {userSearchResults.map(user => (
                            <button
                              key={user.id}
                              className={cn(
                                "w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between",
                                selectedUserToShare === user.id ? "bg-accent" : ""
                              )}
                              onClick={() => {
                                setSelectedUserToShare(user.id);
                                setUserSearchQuery(user.username);
                                setUserSearchResults([]);
                              }}
                            >
                              <span>{user.username}</span>
                              {selectedUserToShare === user.id && <Check className="h-4 w-4 text-primary" />}
                            </button>
                          ))}
                        </div>
                      )}

                      {userSearchQuery.length >= 2 && !isSearchingUsers && userSearchResults.length === 0 && selectedUserToShare === "" && (
                        <div className="p-4 text-center text-sm text-muted-foreground border border-dashed rounded-md">
                          No users found matching "{userSearchQuery}"
                        </div>
                      )}

                      <Button 
                        className="w-full mt-2" 
                        onClick={handleShare} 
                        disabled={!selectedUserToShare}
                      >
                        Share Access
                      </Button>
                    </div>
                    {selectedUserToShare && (
                      <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                        <Label className="text-xs font-medium text-muted-foreground">Permissions for new user</Label>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="perm-edit-nodes"
                            checked={sharePermissions.editNodes || sharePermissions.admin}
                            disabled={sharePermissions.admin}
                            onCheckedChange={(checked) => setSharePermissions(p => ({ ...p, editNodes: !!checked }))}
                          />
                          <Label htmlFor="perm-edit-nodes" className="text-sm font-normal">Edit Nodes</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="perm-edit-templates"
                            checked={sharePermissions.editTemplates || sharePermissions.admin}
                            disabled={sharePermissions.admin}
                            onCheckedChange={(checked) => setSharePermissions(p => ({ ...p, editTemplates: !!checked }))}
                          />
                          <Label htmlFor="perm-edit-templates" className="text-sm font-normal">Edit Templates</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="perm-admin"
                            checked={sharePermissions.admin}
                            onCheckedChange={(checked) => setSharePermissions(p => ({
                              ...p,
                              admin: !!checked,
                              editNodes: !!checked ? true : p.editNodes,
                              editTemplates: !!checked ? true : p.editTemplates,
                            }))}
                          />
                          <Label htmlFor="perm-admin" className="text-sm font-normal">Admin <span className="text-xs text-muted-foreground">(full access + sharing)</span></Label>
                        </div>
                      </div>
                    )}
                    {(() => {
                      const legacyUsers = (selectedTreeToShare?.sharedWith || []).map(uid => ({
                        userId: uid,
                        permissions: { editNodes: false, editTemplates: false, admin: false } as TreePermissions,
                        isLegacy: true,
                      }));
                      const shareUsers = (selectedTreeToShare?.shares || []).map(s => ({
                        userId: s.userId,
                        permissions: s.permissions,
                        isLegacy: false,
                      }));
                      const allCollaborators = [...legacyUsers, ...shareUsers];
                      if (allCollaborators.length === 0) return null;
                      return (
                        <div className="space-y-2 pt-2">
                          <Label>Current Collaborators</Label>
                          {allCollaborators.map(({ userId, permissions, isLegacy }) => {
                            const user = users.find(u => u.id === userId);
                            if (!user) return null;
                            const permLabels = [];
                            if (permissions.admin) permLabels.push('Admin');
                            else {
                              if (permissions.editNodes) permLabels.push('Edit Nodes');
                              if (permissions.editTemplates) permLabels.push('Edit Templates');
                            }
                            const label = permLabels.length > 0 ? permLabels.join(', ') : 'Read-Only';
                            
                            if (editingShareUserId === userId) {
                              return (
                                <div key={userId} className="space-y-3 p-3 border rounded-md bg-muted/30 w-full mt-2">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-sm">{user.username} - Edit Permissions</span>
                                    <div className="flex gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setEditingShareUserId(null)}>Cancel</Button>
                                        <Button size="sm" onClick={saveEditingShare}>Save</Button>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={`edit-perm-edit-nodes-${userId}`}
                                      checked={editingSharePermissions.editNodes || editingSharePermissions.admin}
                                      disabled={editingSharePermissions.admin}
                                      onCheckedChange={(checked) => setEditingSharePermissions(p => ({ ...p, editNodes: !!checked }))}
                                    />
                                    <Label htmlFor={`edit-perm-edit-nodes-${userId}`} className="text-sm font-normal">Edit Nodes</Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={`edit-perm-edit-templates-${userId}`}
                                      checked={editingSharePermissions.editTemplates || editingSharePermissions.admin}
                                      disabled={editingSharePermissions.admin}
                                      onCheckedChange={(checked) => setEditingSharePermissions(p => ({ ...p, editTemplates: !!checked }))}
                                    />
                                    <Label htmlFor={`edit-perm-edit-templates-${userId}`} className="text-sm font-normal">Edit Templates</Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={`edit-perm-admin-${userId}`}
                                      checked={editingSharePermissions.admin}
                                      onCheckedChange={(checked) => setEditingSharePermissions(p => ({
                                        ...p,
                                        admin: !!checked,
                                        editNodes: !!checked ? true : p.editNodes,
                                        editTemplates: !!checked ? true : p.editTemplates,
                                      }))}
                                    />
                                    <Label htmlFor={`edit-perm-admin-${userId}`} className="text-sm font-normal">Admin</Label>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={userId} className="flex items-center justify-between text-sm p-2 bg-muted rounded-md">
                                <div>
                                  <span className="font-medium">{user.username}</span>
                                  <span className="text-xs text-muted-foreground ml-2">({label})</span>
                                </div>
                                <div className="flex items-center">
                                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground shrink-0 mr-1" onClick={() => {
                                    setEditingShareUserId(userId);
                                    setEditingSharePermissions({ ...permissions });
                                  }}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => revokeShareAndClose(selectedTreeToShare!.id, userId)}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </TabsContent>

                <TabsContent value="teams" className="space-y-6 mt-4">
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Share this tree with teams you belong to.</p>
                    <div className="flex gap-2">
                      <Select onValueChange={setSelectedTeamToShare} value={selectedTeamToShare}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a team..." />
                        </SelectTrigger>
                        <SelectContent>
                          {userTeams.filter(t => 
                            !(selectedTreeToShare?.teamShares || []).some(ts => ts.teamId === t.id)
                          ).map(team => (
                            <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleShareTeam} disabled={!selectedTeamToShare}>Add Team</Button>
                    </div>
                    {selectedTeamToShare && (
                      <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                        <Label className="text-xs font-medium text-muted-foreground">Permissions for team</Label>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="team-perm-edit-nodes"
                            checked={teamSharePermissions.editNodes || teamSharePermissions.admin}
                            disabled={teamSharePermissions.admin}
                            onCheckedChange={(checked) => setTeamSharePermissions(p => ({ ...p, editNodes: !!checked }))}
                          />
                          <Label htmlFor="team-perm-edit-nodes" className="text-sm font-normal">Edit Nodes</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="team-perm-edit-templates"
                            checked={teamSharePermissions.editTemplates || teamSharePermissions.admin}
                            disabled={teamSharePermissions.admin}
                            onCheckedChange={(checked) => setTeamSharePermissions(p => ({ ...p, editTemplates: !!checked }))}
                          />
                          <Label htmlFor="team-perm-edit-templates" className="text-sm font-normal">Edit Templates</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="team-perm-admin"
                            checked={teamSharePermissions.admin}
                            onCheckedChange={(checked) => setTeamSharePermissions(p => ({
                              ...p,
                              admin: !!checked,
                              editNodes: !!checked ? true : p.editNodes,
                              editTemplates: !!checked ? true : p.editTemplates,
                            }))}
                          />
                          <Label htmlFor="team-perm-admin" className="text-sm font-normal">Admin</Label>
                        </div>
                      </div>
                    )}
                    {(() => {
                      const teamShares = selectedTreeToShare?.teamShares || [];
                      if (teamShares.length === 0) return null;
                      return (
                        <div className="space-y-2 pt-2">
                          <Label>Team Access</Label>
                          {teamShares.map(({ teamId, permissions }) => {
                            const team = userTeams.find(t => t.id === teamId);
                            if (!team) return null;
                            const permLabels = [];
                            if (permissions.admin) permLabels.push('Admin');
                            else {
                              if (permissions.editNodes) permLabels.push('Edit Nodes');
                              if (permissions.editTemplates) permLabels.push('Edit Templates');
                            }
                            const label = permLabels.length > 0 ? permLabels.join(', ') : 'Read-Only';
                            
                            return (
                              <div key={teamId} className="flex items-center justify-between text-sm p-2 bg-muted rounded-md">
                                <div>
                                  <span className="font-medium">{team.name}</span>
                                  <span className="text-xs text-muted-foreground ml-2">({label})</span>
                                </div>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive shrink-0" onClick={() => revokeShareFromTeamAndClose(selectedTreeToShare!.id, teamId)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </TabsContent>
              </Tabs>

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
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Initial View Mode</Label>
                        <Select value={selectedViewMode} onValueChange={setSelectedViewMode}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="standard">Standard View</SelectItem>
                            <SelectItem value="compact">Compact View</SelectItem>
                            <SelectItem value="two-panel">Two-Panel View</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3 mt-2">
                        <div className="space-y-0.5">
                          <Label htmlFor="explorer-switch">Enable Explorer View</Label>
                          <p className="text-xs text-muted-foreground">Allows viewers to drill down into specific nodes.</p>
                        </div>
                        <Switch
                          id="explorer-switch"
                          checked={selectedExplorerMode}
                          onCheckedChange={setSelectedExplorerMode}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Input readOnly value={getPublicUrl(selectedTreeToShare)} />
                        <Button variant="outline" onClick={() => handleCopyPublicLink(selectedTreeToShare.id)}>
                          <Copy className="mr-2 h-4 w-4" /> Copy Link
                        </Button>
                      </div>
                    </div>
                  )}
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
                  <DialogTitle>Edit Tree</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="rename-title">Title</Label>
                    <Input
                      id="rename-title"
                      value={renamedTitle}
                      onChange={(e) => setRenamedTitle(e.target.value)}
                      placeholder="Enter tree title"
                      disabled={!(treeToRename?.userId === currentUser?.id || treeToRename?.shares?.some(s => s.userId === currentUser?.id && s.permissions.admin))}
                    />
                    {!(treeToRename?.userId === currentUser?.id || treeToRename?.shares?.some(s => s.userId === currentUser?.id && s.permissions.admin)) && (
                      <p className="text-[10px] text-muted-foreground italic">You don't have permission to rename this shared tree.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tree-group">Personal Group</Label>
                    <Select value={editedGroup} onValueChange={setEditedGroup}>
                      <SelectTrigger id="tree-group">
                        <SelectValue placeholder="Select a group" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Ungrouped">Ungrouped</SelectItem>
                        {(currentUser?.customGroups || []).map(g => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                  <Button type="submit">Save Changes</Button>
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
