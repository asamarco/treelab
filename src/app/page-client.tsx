/**
 * @fileoverview
 * This is the main client component of the application, responsible for displaying and
 * interacting with the active data tree.
 */
"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { TreeView } from "@/components/tree/tree-view";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { ConditionalRuleOperator, QueryDefinition, QueryRule, SimpleQueryRule, Template, TreeNode } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Star, Filter, X, Paperclip, Link as LinkIcon, Trash2, PlusCircle, Menu, Undo2, Redo2, History, LayoutPanelLeft, ListOrdered, Rows, Rows3, RefreshCcw, GitPullRequest, GitCommit, Download, FileJson, Archive, FileCode } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ProtectedRoute } from "@/components/protected-route";
import { Label } from "@/components/ui/label";
import { getLatestCommitSha } from "@/lib/data-service";
import { Switch } from "@/components/ui/switch";
import { AppHeader } from "@/components/header";
import { TreePageHeader } from "@/components/tree/tree-page-header";
import { TreePageModals } from "@/components/tree/tree-page-modals";
import { TreeSelectionBar } from "@/components/tree/tree-selection-bar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { startOfDay, endOfDay, parse } from "date-fns";
import { hasAttachments } from "@/components/tree/tree-node-utils";
import { cn, evaluateCondition, generateClientSideId } from "@/lib/utils";
import { useUIContext } from "@/contexts/ui-context";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";


const operatorLabels: Record<ConditionalRuleOperator, string> = {
  equals: 'Equals',
  not_equals: 'Not Equals',
  contains: 'Contains',
  not_contains: 'Does Not Contain',
  is_not_empty: 'Is Not Empty',
  is_empty: 'Is Empty',
  greater_than: 'Greater Than',
  less_than: 'Less Than',
};

function filterTree(
  nodes: TreeNode[],
  getTemplateById: (id: string) => Template | undefined,
  findNodeAndParent: (nodeId: string) => { node: TreeNode; parent: TreeNode | null } | null,
  searchTerm: string,
  showStarredOnly: boolean,
  templateFilter: string | null,
  createdFrom: Date | null,
  createdTo: Date | null,
  modifiedFrom: Date | null,
  modifiedTo: Date | null,
  hasAttachmentsFilter: boolean,
  queryFilter: QueryDefinition[]
): TreeNode[] {
  const lowercasedTerm = searchTerm.toLowerCase();

  const hasMatchingAncestor = (node: TreeNode, relationTemplateId: string, relationRules?: SimpleQueryRule[]): boolean => {
    let current = node;
    while(true) {
        const parentInfo = findNodeAndParent(current.id);
        if (!parentInfo || !parentInfo.parent) {
            return false; 
        }
        const parent = parentInfo.parent;
        if (parent.templateId === relationTemplateId) {
            if (!relationRules || relationRules.length === 0) return true; 
            const matches = (relationRules || []).every(rule => {
                const fieldValue = (parent.data || {})[rule.fieldId];
                return evaluateCondition(rule.operator, fieldValue, rule.value);
            });
            if (matches) return true;
        }
        current = parent;
    }
  };
  
  const hasMatchingDescendant = (node: TreeNode, relationTemplateId: string, relationRules?: SimpleQueryRule[]): boolean => {
      const queue: TreeNode[] = [...(node.children || [])];
      while (queue.length > 0) {
          const currentNode = queue.shift()!;
          if (currentNode.templateId === relationTemplateId) {
              if (!relationRules || relationRules.length === 0) return true;
              const matches = (relationRules || []).every(rule => {
                  const fieldValue = (currentNode.data || {})[rule.fieldId!];
                  return evaluateCondition(rule.operator, fieldValue, rule.value!);
              });
              if (matches) return true;
          }
          if (currentNode.children) {
              queue.push(...currentNode.children);
          }
      }
      return false;
  };


  const doesNodeMatch = (node: TreeNode, isAncestorStarred: boolean): boolean => {
    
    const nameMatches = !!node.name && String(node.name).toLowerCase().includes(lowercasedTerm);
    
    let dataMatches = false;
    if (node.data) {
        dataMatches = Object.values(node.data).some(value =>
            String(value).toLowerCase().includes(lowercasedTerm)
        );
    }
    const isSearchMatch = !searchTerm.trim() || nameMatches || dataMatches;

    const isTemplateMatch = !templateFilter || node.templateId === templateFilter;
    
    const createdAt = node.createdAt ? new Date(node.createdAt) : null;
    const isCreatedDateMatch = 
      (!createdFrom || (createdAt && createdAt >= startOfDay(createdFrom))) &&
      (!createdTo || (createdAt && createdAt <= endOfDay(createdTo)));

    const updatedAt = node.updatedAt ? new Date(node.updatedAt) : null;
    const isModifiedDateMatch =
      (!modifiedFrom || (updatedAt && updatedAt >= startOfDay(modifiedFrom))) &&
      (!modifiedTo || (updatedAt && updatedAt <= endOfDay(modifiedTo)));

    const template = getTemplateById(node.templateId);
    const hasAttachmentsMatch = !hasAttachmentsFilter || (template ? hasAttachments(node, template) : false);

    const isNodeEffectivelyStarred = isAncestorStarred || !!node.isStarred;
    const isStarredMatch = !showStarredOnly || isNodeEffectivelyStarred;

    const isQueryMatch = () => {
        if (!queryFilter || queryFilter.length === 0) {
            return true;
        }

        return queryFilter.some(queryGroup => {
            if (node.templateId !== queryGroup.targetTemplateId) {
                return false;
            }

            return (queryGroup.rules || []).every(rule => {
                const { type = 'field' } = rule;
                if (type === 'field') {
                    if (!rule.fieldId) return false;
                    const fieldValue = (node.data || {})[rule.fieldId];
                    return evaluateCondition(rule.operator as ConditionalRuleOperator, fieldValue, rule.value!);
                }
                if (type === 'ancestor') {
                    if (!rule.relationTemplateId) return false;
                    return hasMatchingAncestor(node, rule.relationTemplateId, rule.relationRules!);
                }
                if (type === 'descendant') {
                    if (!rule.relationTemplateId) return false;
                    return hasMatchingDescendant(node, rule.relationTemplateId, rule.relationRules!);
                }
                return false;
            });
        });
    };

    return !!(isSearchMatch && isTemplateMatch && isCreatedDateMatch && isModifiedDateMatch && hasAttachmentsMatch && isStarredMatch && isQueryMatch());
  };
  
  const search = (nodesToFilter: TreeNode[], isAncestorStarred: boolean, path: Set<string>): TreeNode[] => {
    const results: TreeNode[] = [];

    for (const node of nodesToFilter) {
      if (path.has(node.id)) {
        continue;
      }
      const newPath = new Set(path);
      newPath.add(node.id);

      const nodeIsEffectivelyStarred = isAncestorStarred || !!node.isStarred;
      const matches = doesNodeMatch(node, nodeIsEffectivelyStarred);

      if (matches) {
        results.push(node);
      } else {
        const filteredChildren = search(node.children || [], nodeIsEffectivelyStarred, newPath);
        if (filteredChildren.length > 0) {
          results.push({ ...node, children: filteredChildren });
        }
      }
    }
    return results;
  };
  
  return search(nodes, false, new Set());
}

export function TreePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { toast } = useToast();

  const { currentUser } = useAuthContext();
  const { 
    activeTree,
    getTemplateById, 
    setTreeTitle,
    syncFromRepo,
    selectedNodeIds,
    setSelectedNodeIds,
    conflictState,
    resolveConflict,
    addRootNode,
    reloadActiveTree,
    tree,
    findNodeAndParent,
    isTreeDataLoading,
    canUndo,
    undoLastAction,
    canRedo,
    redoLastAction,
    undoActionDescription,
    redoActionDescription,
    exportNodesAsArchive,
    exportNodesAsHtml,
    exportNodesAsJson,
  } = useTreeContext();
  const { setDialogState, setIsCompactView, setShowNodeOrder, dialogState, isCompactView, showNodeOrder, isTwoPanelMode, setIsTwoPanelMode } = useUIContext();
  const isMobile = useIsMobile();

  const [searchTerm, setSearchTerm] = useState("");
  const [showStarred, setShowStarred] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [remoteSha, setRemoteSha] = useState<string | null>(null);
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const [createdFrom, setCreatedFrom] = useState<Date | undefined>(undefined);
  const [createdTo, setCreatedTo] = useState<Date | undefined>(undefined);
  const [modifiedFrom, setModifiedFrom] = useState<Date | undefined>(undefined);
  const [modifiedTo, setModifiedTo] = useState<Date | undefined>(undefined);
  const [hasAttachmentsFilter, setHasAttachmentsFilter] = useState(false);
  const [queryFilter, setQueryFilter] = useState<QueryDefinition[]>([]);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (showStarred) count++;
    if (templateFilter) count++;
    if (createdFrom) count++;
    if (createdTo) count++;
    if (modifiedFrom) count++;
    if (modifiedTo) count++;
    if (hasAttachmentsFilter) count++;
    if (queryFilter.length > 0) count++;
    return count;
  }, [showStarred, templateFilter, createdFrom, createdTo, modifiedFrom, modifiedTo, hasAttachmentsFilter, queryFilter]);

  const areFiltersActive = activeFilterCount > 0;

  useEffect(() => {
    setIsClient(true);
  }, []);

  const isLoading = isTreeDataLoading || !activeTree;
  
  useEffect(() => {
    if (currentUser && isClient && !isLoading && !activeTree) {
        router.replace('/roots');
    }
  }, [isClient, isLoading, activeTree, router, currentUser]);
  
  useEffect(() => {
    const previewNodeId = searchParams.get('previewNode');
    if (previewNodeId) {
      setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [previewNodeId] });
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, setDialogState, router, pathname]);

  useEffect(() => {
    if (isTwoPanelMode && selectedNodeIds.length === 0 && tree && tree.length > 0) {
      setSelectedNodeIds([`${tree[0].id}_root`]);
    }
  }, [isTwoPanelMode, selectedNodeIds.length, tree, setSelectedNodeIds]);

  const checkSyncStatus = useCallback(async () => {
    if (!currentUser || !activeTree?.gitSync || !currentUser?.gitSettings?.githubPat || isTokenInvalid) {
      setRemoteSha(null);
      return;
    }
    setIsCheckingSync(true);
    try {
      const { repoOwner, repoName, branch } = activeTree.gitSync;
      const latestSha = await getLatestCommitSha(currentUser.gitSettings.githubPat, repoOwner, repoName, branch);
      setRemoteSha(latestSha);
      setIsTokenInvalid(false);
    } catch (error) {
      console.error("Failed to check sync status:", error);
      if (error instanceof Error && error.message.includes('Bad credentials')) {
        setIsTokenInvalid(true);
      }
      setRemoteSha(null);
    } finally {
      setIsCheckingSync(false);
    }
  }, [activeTree?.gitSync, currentUser, isTokenInvalid]);


  useEffect(() => {
    checkSyncStatus();
  }, [activeTree?.gitSync, currentUser?.gitSettings?.githubPat, checkSyncStatus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
         activeElement.tagName === 'TEXTAREA' ||
         activeElement.isContentEditable)
      ) {
        return;
      }
      
      const isAnyModalOpen = Object.values(dialogState).some(state => state === true);
      if (isAnyModalOpen) {
        return;
      }
      
      switch (event.key) {
        case ' ':
          if(isMobile) return;
          event.preventDefault();
          setIsCompactView(prev => !prev);
          break;
        case 's':
           if (event.ctrlKey || event.metaKey) return; 
           event.preventDefault();
           setShowStarred(prev => !prev);
           break;
        case 'o':
          if(isMobile) return;
          event.preventDefault();
          setShowNodeOrder(prev => !prev);
          break;
        case 'r':
          if (!currentUser) return; 
          event.preventDefault();
          reloadActiveTree();
          break;
        case 'p':
          if (isMobile) return;
          event.preventDefault();
          setIsTwoPanelMode(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setIsCompactView, setShowStarred, setShowNodeOrder, reloadActiveTree, dialogState, currentUser, isMobile, setIsTwoPanelMode]);

  const filteredTree = useMemo(() => {
      try {
          if (!tree) return [];
          return filterTree(tree, getTemplateById, findNodeAndParent, searchTerm, showStarred, templateFilter, createdFrom ?? null, createdTo ?? null, modifiedFrom ?? null, modifiedTo ?? null, hasAttachmentsFilter, queryFilter);
      } catch (error) {
          if (error instanceof RangeError && error.message.includes("Maximum call stack size exceeded")) {
              console.warn("A cyclical reference was detected in the tree structure during filtering.");
              return [];
          }
          throw error;
      }
  }, [tree, getTemplateById, findNodeAndParent, searchTerm, showStarred, templateFilter, createdFrom, createdTo, modifiedFrom, modifiedTo, hasAttachmentsFilter, queryFilter]);
  
  const resetFilters = () => {
    setTemplateFilter(null);
    setCreatedFrom(undefined);
    setCreatedTo(undefined);
    setModifiedFrom(undefined);
    setModifiedTo(undefined);
    setHasAttachmentsFilter(false);
    setQueryFilter([]);
  }

  const handleSaveNewRootNode = async (newNode: Partial<TreeNode>) => {
    if (!activeTree) return;
    await addRootNode(newNode);
  };
  
  const handleTitleSave = (newTitle: string) => {
    if (!activeTree) return;
    setTreeTitle(activeTree.id, newTitle);
  }

  const [detailsExpandedNodeIds, setDetailsExpandedNodeIds] = useState<string[]>([]);

  const nodesForDetails = useMemo(() => {
    if (!isTwoPanelMode || selectedNodeIds.length === 0) return [];
    
    const nodes = selectedNodeIds
        .map(id => findNodeAndParent(id.split('_')[0])?.node)
        .filter((n): n is TreeNode => !!n);
    
    return nodes;
  }, [isTwoPanelMode, selectedNodeIds, findNodeAndParent]);

  useEffect(() => {
    if (isTwoPanelMode && nodesForDetails.length > 0) {
        const allIds = new Set<string>();
        const traverse = (nodesToTraverse: TreeNode[], parentId: string | null) => {
            for (const node of nodesToTraverse) {
                allIds.add(`${node.id}_${parentId || 'root'}`);
                if (node.children) {
                    traverse(node.children, node.id);
                }
            }
        };
        traverse(nodesForDetails, null);
        setDetailsExpandedNodeIds(Array.from(allIds));
    }
  }, [isTwoPanelMode, nodesForDetails]);

  const renderMainContent = () => {
    if (isLoading) {
      return (
        <Card className="flex flex-col items-center justify-center h-64 border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold">Loading...</h3>
          </div>
        </Card>
      );
    }
    
    if (filteredTree.length === 0 && (!isLoading || isClient)) {
      return (
        <Card className="flex flex-col items-center justify-center h-64 border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold">No nodes found</h3>
            <p className="text-muted-foreground">
              {searchTerm || areFiltersActive
                ? "Your filters did not return any results."
                : "Get started by adding a root node."}
            </p>
          </div>
        </Card>
      );
    }
    
    if (isTwoPanelMode && !isMobile) {
        return (
            <div className="h-[calc(100vh-14rem)]">
                <ResizablePanelGroup direction="horizontal" className="flex h-full">
                    <ResizablePanel defaultSize={25} minSize={20}>
                        <ScrollArea className="h-full rounded-lg border bg-card/30 mr-2">
                            <div className="p-2">
                                <TreeView nodes={filteredTree} isCompactOverride={true} />
                            </div>
                        </ScrollArea>
                    </ResizablePanel>
                    
                    <ResizableHandle withHandle />
                    
                    <ResizablePanel defaultSize={75} minSize={30}>
                        <ScrollArea className="h-full rounded-lg border bg-card p-6 ml-2">
                            {nodesForDetails.length > 0 ? (
                                <TreeView 
                                    nodes={nodesForDetails} 
                                    overrideExpandedIds={detailsExpandedNodeIds}
                                    onExpandedChange={(updater) => setDetailsExpandedNodeIds(updater as any)}
                                    disableSelection={true}
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                                    <div className="rounded-full bg-muted p-4">
                                        <LayoutPanelLeft className="h-8 w-8 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold">No node selected</h3>
                                        <p className="text-muted-foreground">Select a node on the left to view its details here.</p>
                                    </div>
                                </div>
                            )}
                        </ScrollArea>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        );
    }

    return <TreeView nodes={filteredTree} />;
  }


  if (isLoading && !isClient) {
       return (
        <div className="flex flex-col min-h-screen bg-background">
            <AppHeader />
            <main className="flex-1 flex items-center justify-center">
                 <Card>
                    <CardContent className="p-6 text-center">
                        <h2 className="text-xl font-semibold mb-2">Loading...</h2>
                        <p className="text-muted-foreground">Please wait while we load your data.</p>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
  }
  
  const handleDateChange = (setter: React.Dispatch<React.SetStateAction<Date | undefined>>) => (dateString: string | undefined) => {
    if (dateString) {
      const d = parse(dateString, 'yyyy-MM-dd', new Date());
      if (!isNaN(d.getTime())) {
        setter(d);
        return;
      }
    }
    setter(undefined);
  };

  const handleQueryGroupChange = (queryIndex: number, key: keyof Omit<QueryDefinition, 'id'>, value: any) => {
      const newQueryFilter = [...queryFilter];
      newQueryFilter[queryIndex] = { ...newQueryFilter[queryIndex], [key]: value };
      setQueryFilter(newQueryFilter);
  };

  const handleRuleChange = (queryIndex: number, ruleIndex: number, key: keyof QueryRule, value: any) => {
      const newQueryFilter = [...queryFilter];
      const newRules = [...newQueryFilter[queryIndex].rules];
      const newRule = { ...newRules[ruleIndex], [key]: value };
      
      if (key === 'type') {
        if (value === 'field') {
            delete newRule.fieldId;
            delete newRule.operator;
            delete newRule.value;
            delete newRule.relationTemplateId;
            delete newRule.relationRules;
        } else {
            delete newRule.fieldId;
            delete newRule.operator;
            delete newRule.value;
        }
      }

      newRules[ruleIndex] = newRule;
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const handleRelationRuleChange = (queryIndex: number, ruleIndex: number, relRuleIndex: number, key: keyof SimpleQueryRule, value: any) => {
    const newQueryFilter = [...queryFilter];
    const newRules = [...newQueryFilter[queryIndex].rules];
    const newRelationRules = [...(newRules[ruleIndex].relationRules || [])];
    newRelationRules[relRuleIndex] = { ...newRelationRules[relRuleIndex], [key]: value };
    newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const addQueryGroup = () => {
      setQueryFilter([...queryFilter, { id: generateClientSideId(), targetTemplateId: null, rules: [] }]);
  };
  
  const removeQueryGroup = (queryIndex: number) => {
      setQueryFilter(queryFilter.filter((_, index) => index !== queryIndex));
  }

  const addRule = (queryIndex: number) => {
      const newRules = [...(queryFilter[queryIndex].rules || []), { id: generateClientSideId(), type: 'field', fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const removeRule = (queryIndex: number, ruleIndex: number) => {
      const newRules = (queryFilter[queryIndex].rules || []).filter((_, index) => index !== ruleIndex);
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const addRelationRule = (queryIndex: number, ruleIndex: number) => {
    const newQueryFilter = [...queryFilter];
    const newRules = [...newQueryFilter[queryIndex].rules];
    const newRelationRules = [...(newRules[ruleIndex].relationRules || []), { id: generateClientSideId(), fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
    newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const removeRelationRule = (queryIndex: number, ruleIndex: number, relRuleIndex: number) => {
      const newQueryFilter = [...queryFilter];
      const newRules = [...newQueryFilter[queryIndex].rules];
      const newRelationRules = (newRules[ruleIndex].relationRules || []).filter((_, index) => index !== relRuleIndex);
      newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };
  
  const renderFilterContent = () => (
    <div className="grid gap-4">
      <div className="space-y-2">
          <h4 className="font-medium leading-none">Advanced Filters</h4>
      </div>
      <div className="grid gap-2">
          <Label>Template</Label>
           <Select value={templateFilter || 'all'} onValueChange={(value) => setTemplateFilter(value === 'all' ? null : value)}>
              <SelectTrigger>
                  <SelectValue placeholder="Filter by template..." />
              </SelectTrigger>
              <SelectContent>
                  <SelectItem value="all">All Templates</SelectItem>
                  {activeTree?.templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
              </SelectContent>
          </Select>
      </div>
       <div className="grid gap-2">
          <Label>Date Created</Label>
          <div className="flex gap-2">
              <DatePicker date={createdFrom} setDate={handleDateChange(setCreatedFrom)} placeholder="From" />
              <DatePicker date={createdTo} setDate={handleDateChange(setCreatedTo)} placeholder="To" />
          </div>
      </div>
       <div className="grid gap-2">
          <Label>Date Modified</Label>
          <div className="flex gap-2">
              <DatePicker date={modifiedFrom} setDate={handleDateChange(setModifiedFrom)} placeholder="From" />
              <DatePicker date={modifiedTo} setDate={handleDateChange(setModifiedTo)} placeholder="To" />
          </div>
      </div>
      <div className="flex items-center space-x-2">
        <Switch
          id="has-attachments-filter"
          checked={hasAttachmentsFilter}
          onCheckedChange={setHasAttachmentsFilter}
        />
        <Label htmlFor="has-attachments-filter" className="flex items-center gap-1">
          <Paperclip className="h-4 w-4" />
          Has Attachments
        </Label>
      </div>

      <Separator />

      <div className="space-y-2">
        <h4 className="font-medium leading-none">Query Builder</h4>
        <p className="text-sm text-muted-foreground">
            Find nodes matching specific criteria.
        </p>
      </div>
      <div className="space-y-4 max-h-64 overflow-y-auto pr-2">
          {queryFilter.map((queryDef, queryIndex) => {
            const targetTemplate = queryDef.targetTemplateId ? getTemplateById(queryDef.targetTemplateId) : null;
            const templates = activeTree?.templates || [];
            return (
                <Card key={queryDef.id || queryIndex} className="bg-muted/50 p-4 space-y-4">
                    <div className="flex justify-between items-center">
                        <Label>Search nodes with template:</Label>
                        <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeQueryGroup(queryIndex)}>
                            <Trash2 className="h-4 w-4"/>
                        </Button>
                    </div>
                    <Select value={queryDef.targetTemplateId || ''} onValueChange={(val) => handleQueryGroupChange(queryIndex, 'targetTemplateId', val)}>
                        <SelectTrigger><SelectValue placeholder="Select template..."/></SelectTrigger>
                        <SelectContent>
                            {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    
                    <div className="space-y-2">
                         <Label>Where...</Label>
                         {(queryDef.rules || []).map((rule, ruleIndex) => {
                           const ruleType = rule.type || 'field';
                           const relationTemplate = rule.relationTemplateId ? getTemplateById(rule.relationTemplateId) : null;
                           return (
                             <Card key={rule.id || ruleIndex} className="p-2 bg-background space-y-2">
                                <div className="space-y-4">
                                     <div className="flex items-center justify-between">
                                        <Select value={ruleType} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'type', val as any)}>
                                            <SelectTrigger className="w-auto"><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="field">Field</SelectItem>
                                                <SelectItem value="ancestor">Ancestor</SelectItem>
                                                <SelectItem value="descendant">Descendant</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRule(queryIndex, ruleIndex)}>
                                            <Trash2 className="h-4 w-4"/>
                                        </Button>
                                     </div>
                                     {ruleType === 'field' ? (
                                        <div className="space-y-2">
                                            <Select value={rule.fieldId || ''} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'fieldId', val)} disabled={!targetTemplate}>
                                                <SelectTrigger><SelectValue placeholder="Field..."/></SelectTrigger>
                                                <SelectContent>
                                                    {targetTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Select value={rule.operator || 'equals'} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'operator', val as any)}>
                                                <SelectTrigger><SelectValue placeholder="Operator..."/></SelectTrigger>
                                                <SelectContent>
                                                    {Object.entries(operatorLabels).map(([op, label]) => <SelectItem key={op} value={op}>{label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <Input value={rule.value || ''} onChange={(e) => handleRuleChange(queryIndex, ruleIndex, 'value', e.target.value)} placeholder="Value..."/>
                                        </div>
                                     ) : (
                                        <div className="space-y-2">
                                           <span className="text-sm p-2 block">has {String(ruleType)} with template:</span>
                                            <Select value={rule.relationTemplateId || ''} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'relationTemplateId', val)}>
                                                <SelectTrigger><SelectValue placeholder="Template..."/></SelectTrigger>
                                                <SelectContent>
                                                    {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                     )}
                                 </div>
                                 { (ruleType === 'ancestor' || ruleType === 'descendant') && rule.relationTemplateId && (
                                     <div className="pl-6 space-y-2">
                                        <Label className="text-xs text-muted-foreground">Where...</Label>
                                         {(rule.relationRules || []).map((relRule, relRuleIndex) => (
                                             <Card key={relRule.id} className="p-2 bg-muted/50">
                                                 <div className="space-y-2">
                                                     <Select value={relRule.fieldId} onValueChange={(val) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'fieldId', val)}>
                                                         <SelectTrigger><SelectValue placeholder="Field..." /></SelectTrigger>
                                                         <SelectContent>{relationTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                                                     </Select>
                                                     <Select value={relRule.operator} onValueChange={(val) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'operator', val as any)}>
                                                        <SelectTrigger><SelectValue placeholder="Operator..."/></SelectTrigger>
                                                        <SelectContent>
                                                            {Object.entries(operatorLabels).map(([op, label]) => <SelectItem key={op} value={op}>{label}</SelectItem>)}
                                                        </SelectContent>
                                                     </Select>
                                                     <Input value={relRule.value} onChange={(e) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'value', e.target.value)} placeholder="Value..."/>
                                                     <div className="flex justify-end">
                                                        <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRelationRule(queryIndex, ruleIndex, relRuleIndex)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                     </div>
                                                 </div>
                                             </Card>
                                         ))}
                                         <Button type="button" variant="outline" size="sm" onClick={() => addRelationRule(queryIndex, ruleIndex)}>
                                             <PlusCircle className="mr-2 h-4 w-4" /> Add condition
                                         </Button>
                                     </div>
                                 )}
                             </Card>
                           )
                         })}
                        <Button type="button" variant="outline" size="sm" onClick={() => addRule(queryIndex)} disabled={!targetTemplate}>
                            <PlusCircle className="mr-2 h-4 w-4"/> Add AND Condition
                        </Button>
                    </div>
                </Card>
            )
          })}
          <Button type="button" variant="outline" className="w-full" onClick={addQueryGroup}>
            <PlusCircle className="mr-2 h-4 w-4"/> Add OR Group
          </Button>
        </div>

      <Separator />

      <Button variant="outline" onClick={resetFilters}>
          <X className="mr-2 h-4 w-4" /> Reset All Filters
      </Button>
    </div>
  );
  
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AppHeader />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <div className={cn("sticky z-20 bg-background/95 backdrop-blur-sm -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 pb-4 border-b", currentUser ? "top-16" : "top-0")}>
          {activeTree && (
            <TreePageHeader 
              tree={activeTree}
              isCheckingSync={isCheckingSync}
              remoteSha={remoteSha}
              onTitleSave={handleTitleSave}
              onSync={syncFromRepo}
              onCommit={checkSyncStatus}
              onReload={() => reloadActiveTree()}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              showStarred={showStarred}
              setShowStarred={setShowStarred}
              activeFilterCount={activeFilterCount}
              onFilterClick={() => setIsFilterDialogOpen(true)}
              renderFilterContent={renderFilterContent}
            />
          )}
        </div>
        
        <div className="mt-6">
          {activeTree && (
            <TreePageModals 
              activeTree={activeTree}
              templates={activeTree.templates}
              getTemplateById={getTemplateById}
              onSaveNewRootNode={handleSaveNewRootNode}
              conflictState={conflictState}
              onConflictResolve={resolveConflict}
              syncFromRepo={syncFromRepo}
            />
          )}

          {renderMainContent()}
        </div>

        <TreeSelectionBar />
      </main>

      <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
          </DialogHeader>
          <div className="pt-4">
            {renderFilterContent()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
