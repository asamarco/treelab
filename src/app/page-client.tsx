
/**
 * @fileoverview
 * This is the main client component of the application, responsible for displaying and
 * interacting with the active data tree.
 *
 * It uses child components to render the header, modals, and selection bar,
 * keeping the main component focused on state management and data flow.
 */
"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { TreeView } from "@/components/tree/tree-view";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { ConditionalRuleOperator, QueryDefinition, QueryRule, Template, TreeNode } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Star, Filter, X, Paperclip, Link as LinkIcon, Trash2, PlusCircle } from "lucide-react";
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
import { DatePicker } from "@/components/ui/date-picker";
import { startOfDay, endOfDay, parse } from "date-fns";
import { hasAttachments } from "@/components/tree/tree-node-utils";
import { cn, evaluateCondition, generateClientSideId } from "@/lib/utils";
import { useUIContext } from "@/contexts/ui-context";
import { Separator } from "@/components/ui/separator";


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
            if (!queryGroup.targetTemplateId) {
                return false;
            }

            if (node.templateId !== queryGroup.targetTemplateId) {
                return false;
            }
            
            return queryGroup.rules.every(rule => {
                if (!rule.fieldId) return false;
                const fieldValue = (node.data || {})[rule.fieldId];
                return evaluateCondition(rule.operator as ConditionalRuleOperator, fieldValue, rule.value);
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
        // If the node matches, we include it and all its children.
        results.push(node);
      } else {
        // If the node doesn't match, we check its children.
        const filteredChildren = search(node.children || [], nodeIsEffectivelyStarred, newPath);
        if (filteredChildren.length > 0) {
          // If any child (or descendant) matches, we include the current node but with only the filtered children.
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

  const { currentUser } = useAuthContext();
  const { 
    activeTree,
    getTemplateById, 
    setTreeTitle,
    syncFromRepo,
    setSelectedNodeIds,
    conflictState,
    resolveConflict,
    addRootNode,
    commitToRepo,
    reloadActiveTree,
    tree,
    isTreeDataLoading,
  } = useTreeContext();
  const { setDialogState, setIsCompactView, setShowNodeOrder, dialogState } = useUIContext();

  const [searchTerm, setSearchTerm] = useState("");
  const [showStarred, setShowStarred] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [remoteSha, setRemoteSha] = useState<string | null>(null);
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);

  // New filter states
  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const [createdFrom, setCreatedFrom] = useState<Date | undefined>(undefined);
  const [createdTo, setCreatedTo] = useState<Date | undefined>(undefined);
  const [modifiedFrom, setModifiedFrom] = useState<Date | undefined>(undefined);
  const [modifiedTo, setModifiedTo] = useState<Date | undefined>(undefined);
  const [hasAttachmentsFilter, setHasAttachmentsFilter] = useState(false);
  const [queryFilter, setQueryFilter] = useState<QueryDefinition[]>([]);

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

  const templates = activeTree?.templates || [];

  useEffect(() => {
    setIsClient(true);
  }, []);

  const isLoading = isTreeDataLoading || !activeTree;
  
  useEffect(() => {
    // Only redirect if a user is logged in. Public views should not redirect.
    if (currentUser && isClient && !isLoading && !activeTree) {
        router.replace('/roots');
    }
  }, [isClient, isLoading, activeTree, router, currentUser]);

  useEffect(() => {
    const previewNodeId = searchParams.get('previewNode');
    if (previewNodeId) {
      setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [previewNodeId] });
      // Clean up the URL
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, setDialogState, router, pathname]);

  useEffect(() => {
    setSelectedNodeIds([]);
  }, [activeTree?.id, setSelectedNodeIds]);

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

    // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if focus is on an input, textarea, or contentEditable element
      const activeElement = document.activeElement as HTMLElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
         activeElement.tagName === 'TEXTAREA' ||
         activeElement.isContentEditable)
      ) {
        return;
      }
      
      // Check if any modal is open before processing shortcuts
      const isAnyModalOpen = Object.values(dialogState).some(state => state === true);
      if (isAnyModalOpen) {
        return;
      }
      
      switch (event.key) {
        case ' ':
          event.preventDefault();
          setIsCompactView(prev => !prev);
          break;
        case 's':
           if (event.ctrlKey || event.metaKey) return; // ignore save
           event.preventDefault();
           setShowStarred(prev => !prev);
           break;
        case 'o':
          event.preventDefault();
          setShowNodeOrder(prev => !prev);
          break;
        case 'r':
          if (!currentUser) return; // Prevent public users from reloading
          event.preventDefault();
          reloadActiveTree();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setIsCompactView, setShowStarred, setShowNodeOrder, reloadActiveTree, dialogState, currentUser]);

  const filteredTree = useMemo(() => {
      try {
          if (!tree) return [];
          return filterTree(tree, getTemplateById, searchTerm, showStarred, templateFilter, createdFrom ?? null, createdTo ?? null, modifiedFrom ?? null, modifiedTo ?? null, hasAttachmentsFilter, queryFilter);
      } catch (error) {
          if (error instanceof RangeError && error.message.includes("Maximum call stack size exceeded")) {
              console.warn("A cyclical reference was detected in the tree structure during filtering. This can happen if a node is cloned as a child of itself. Search is disabled until this is resolved.");
              return [];
          }
          throw error;
      }
  }, [tree, getTemplateById, searchTerm, showStarred, templateFilter, createdFrom, createdTo, modifiedFrom, modifiedTo, hasAttachmentsFilter, queryFilter]);
  
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
    
    // Show "No nodes" message if loading is complete and tree is empty
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
    
    // Show the tree view if nodes exist
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
      newRules[ruleIndex] = { ...newRules[ruleIndex], [key]: value };
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const addQueryGroup = () => {
      setQueryFilter([...queryFilter, { id: generateClientSideId(), targetTemplateId: null, rules: [] }]);
  };
  
  const removeQueryGroup = (queryIndex: number) => {
      setQueryFilter(queryFilter.filter((_, index) => index !== queryIndex));
  }

  const addRule = (queryIndex: number) => {
      const newRules = [...queryFilter[queryIndex].rules, { id: generateClientSideId(), fieldId: '', operator: 'equals', value: '' }];
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const removeRule = (queryIndex: number, ruleIndex: number) => {
      const newRules = queryFilter[queryIndex].rules.filter((_, index) => index !== ruleIndex);
      handleQueryGroupChange(queryIndex, 'rules', newRules);
  };
  
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AppHeader />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        {activeTree && (
          <TreePageHeader 
            tree={activeTree}
            isCheckingSync={isCheckingSync}
            remoteSha={remoteSha}
            onTitleSave={handleTitleSave}
            onSync={syncFromRepo}
            onCommit={checkSyncStatus}
            onReload={() => reloadActiveTree()}
          />
        )}
       
        <div className="relative mb-6 flex gap-4 items-center">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search for nodes..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn(areFiltersActive && "border-primary text-primary")}>
                <Filter className={cn("mr-2 h-4 w-4", areFiltersActive && "fill-current")} />
                Filters {areFiltersActive && `(${activeFilterCount})`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96" align="end">
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
                              {templates.map(t => (
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
                        Find nodes matching specific criteria. Groups are combined with OR, conditions within a group are combined with AND.
                    </p>
                  </div>
                  <div className="space-y-4 max-h-64 overflow-y-auto pr-2">
                      {queryFilter.map((queryDef, queryIndex) => {
                        const targetTemplate = queryDef.targetTemplateId ? getTemplateById(queryDef.targetTemplateId) : null;
                        return (
                            <Card key={queryDef.id || queryIndex} className="bg-muted/50 p-4 space-y-4">
                                <div className="flex justify-between items-center">
                                    <Label>Search for nodes with template:</Label>
                                    <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeQueryGroup(queryIndex)}>
                                        <Trash2 className="h-4 w-4"/>
                                    </Button>
                                </div>
                                <Select value={queryDef.targetTemplateId || ''} onValueChange={(val) => handleQueryGroupChange(queryIndex, 'targetTemplateId', val)}>
                                    <SelectTrigger><SelectValue placeholder="Select a template..."/></SelectTrigger>
                                    <SelectContent>
                                        {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                
                                <div className="space-y-2">
                                     <Label>Where...</Label>
                                     {queryDef.rules.map((rule, ruleIndex) => (
                                         <Card key={rule.id || ruleIndex} className="p-2 bg-background">
                                             <div className="flex items-center gap-2">
                                                 <Select value={rule.fieldId} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'fieldId', val)} disabled={!targetTemplate}>
                                                    <SelectTrigger><SelectValue placeholder="Field..."/></SelectTrigger>
                                                    <SelectContent>
                                                        {targetTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                                                    </SelectContent>
                                                 </Select>
                                                  <Select value={rule.operator} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'operator', val)}>
                                                    <SelectTrigger className="w-48"><SelectValue placeholder="Operator..."/></SelectTrigger>
                                                    <SelectContent>
                                                        {Object.entries(operatorLabels).map(([op, label]) => (
                                                            <SelectItem key={op} value={op as ConditionalRuleOperator}>{label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                 </Select>
                                                 <Input value={rule.value} onChange={(e) => handleRuleChange(queryIndex, ruleIndex, 'value', e.target.value)} placeholder="Value..."/>
                                                 <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRule(queryIndex, ruleIndex)}>
                                                     <Trash2 className="h-4 w-4"/>
                                                 </Button>
                                             </div>
                                         </Card>
                                     ))}
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
            </PopoverContent>
          </Popover>
          <div className="flex items-center space-x-2">
              <Switch 
                  id="starred-filter" 
                  checked={showStarred}
                  onCheckedChange={setShowStarred}
              />
              <Label htmlFor="starred-filter" className="flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-400"/> Favorites
              </Label>
          </div>
        </div>
        
        {activeTree && (
          <TreePageModals 
            activeTree={activeTree}
            templates={templates}
            getTemplateById={getTemplateById}
            onSaveNewRootNode={handleSaveNewRootNode}
            conflictState={conflictState}
            onConflictResolve={resolveConflict}
            syncFromRepo={syncFromRepo}
          />
        )}

        {renderMainContent()}

        <TreeSelectionBar />
      </main>
    </div>
  );
}
