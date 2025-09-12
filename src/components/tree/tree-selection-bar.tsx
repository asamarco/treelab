

/**
 * @fileoverview
 * Renders a floating action bar at the bottom of the screen when one or more
 * nodes are selected, providing bulk actions like copy, cut, and delete.
 */
"use client";

import { useTreeContext } from "@/contexts/tree-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Copy, Scissors, Trash2, ChevronsUpDown, ChevronsDownUp, X, Download,
  FileJson, FileCode, FileText, Archive, ChevronDown, Eye, RefreshCcw,
  ClipboardPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TreeNode } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIContext } from "@/contexts/ui-context";
import { useAuthContext } from "@/contexts/auth-context";
import { useState, useEffect, useCallback, useRef } from "react";
import { HtmlExportView } from "./html-export-view";


export function TreeSelectionBar() {
    const {
        selectedNodeIds,
        setSelectedNodeIds,
        tree,
        findNodeAndParent,
        setClipboard,
        deleteNodes,
        expandAllFromNode,
        collapseAllFromNode,
        exportNodesAsArchive,
        exportNodesAsHtml,
        exportNodesAsJson,
        getTemplateById,
        clipboard,
        pasteNodesAsClones,
    } = useTreeContext();
    const { setDialogState } = useUIContext();
    const { currentUser } = useAuthContext();
    const { toast } = useToast();
    const deleteTriggerRef = useRef<HTMLButtonElement>(null);

    const getSelectedTopLevelNodes = useCallback((): {node: TreeNode, parentId: string | null}[] => {
      const topLevelInstanceIds = new Set(selectedNodeIds);

      // For each selected node, if its parent is also selected, it's not a top-level node.
      for (const instanceId of selectedNodeIds) {
          const [nodeId, parentIdStr] = instanceId.split('_');
          const nodeInfo = findNodeAndParent(nodeId, tree);
          
          if (nodeInfo?.parent) {
              const parentInstanceId = `${nodeInfo.parent.id}_${findNodeAndParent(nodeInfo.parent.id, tree)?.parent?.id || 'root'}`;
              // This logic is imperfect for multi-parent nodes but a good start.
              // We check if *any* potential parent instance is in the selection.
              const parentIsSelected = selectedNodeIds.some(id => id.startsWith(`${nodeInfo.parent?.id}_`));

              if(parentIsSelected) {
                 topLevelInstanceIds.delete(instanceId);
              }
          }
      }

      return Array.from(topLevelInstanceIds).map(instanceId => {
        const [nodeId, parentId] = instanceId.split('_');
        const nodeInfo = findNodeAndParent(nodeId, tree);
        return {node: nodeInfo!.node, parentId: parentId === 'root' ? null : parentId };
      }).filter(item => !!item.node);
    }, [selectedNodeIds, findNodeAndParent, tree]);

    const handleCopySelection = useCallback(() => {
        // To preserve order, we must get the visual order of all nodes first.
        const visuallyOrderedInstances: { instanceId: string; node: TreeNode }[] = [];
        const traverse = (nodes: TreeNode[], parentId: string | null) => {
            nodes.forEach(node => {
                const instanceId = `${node.id}_${parentId || 'root'}`;
                visuallyOrderedInstances.push({ instanceId, node });
                if (node.children) traverse(node.children, node.id);
            });
        };
        traverse(tree, null);

        // Then, filter this ordered list to get only the selected nodes.
        const orderedSelectedInstanceIds = visuallyOrderedInstances
            .map(i => i.instanceId)
            .filter(id => selectedNodeIds.includes(id));
        
        // Now, find the top-level nodes *from this ordered selection*.
        const topLevelInstanceIds = new Set(orderedSelectedInstanceIds);
        for (const instanceId of orderedSelectedInstanceIds) {
            const nodeInfo = findNodeAndParent(instanceId.split('_')[0]);
            if (nodeInfo?.parent) {
                // A node is not top-level if any of its possible parents are also in the selection.
                const parentIsSelected = selectedNodeIds.some(id => id.startsWith(`${nodeInfo.parent?.id}_`));
                if (parentIsSelected) {
                    topLevelInstanceIds.delete(instanceId);
                }
            }
        }
        
        const fullNodesToCopy = Array.from(topLevelInstanceIds)
            .map(instanceId => findNodeAndParent(instanceId.split('_')[0])?.node)
            .filter((n): n is TreeNode => !!n);

        if (fullNodesToCopy.length > 0) {
            setClipboard({ nodes: fullNodesToCopy, operation: 'copy' });
            toast({
                title: 'Copied',
                description: `${fullNodesToCopy.length} node(s) and their children copied to clipboard.`
            });
        }
    }, [selectedNodeIds, tree, findNodeAndParent, setClipboard, toast]);

    const handleCutSelection = useCallback(() => {
        const instancesToCut = getSelectedTopLevelNodes().map(item => {
            return { ...item.node, parentIds: [item.parentId!] } // Store the contextual parent
        });
        if (instancesToCut.length > 0) {
            setClipboard({ nodes: instancesToCut, operation: 'cut' });
            toast({ title: 'Cut', description: `${instancesToCut.length} node instance(s) cut to clipboard.` });
        }
    }, [getSelectedTopLevelNodes, setClipboard, toast]);
    
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
          if (selectedNodeIds.length === 0) return;
    
          const activeElement = document.activeElement as HTMLElement;
          if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
            return;
          }

          if (event.ctrlKey || event.metaKey) {
            if (event.key === 'c') {
              event.preventDefault();
              handleCopySelection();
            } else if (event.key === 'x') {
              event.preventDefault();
              handleCutSelection();
            }
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            deleteTriggerRef.current?.click();
          }
        };
    
        window.addEventListener('keydown', handleKeyDown);
        return () => {
          window.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedNodeIds.length, handleCopySelection, handleCutSelection]);

    const handlePasteAsClone = (as: 'child' | 'sibling') => {
        if (!clipboard.nodes || clipboard.operation === 'cut') return;
        
        // This relies on the fact that for selection actions, there's usually a "last selected" or single target.
        // We'll use the first selected item as the target for this context menu action.
        const targetInstanceId = selectedNodeIds[0];
        if (!targetInstanceId) return;

        const [targetNodeId, contextualParentId] = targetInstanceId.split('_');
        const nodeIdsToClone = clipboard.nodes.map(n => n.id);

        pasteNodesAsClones(targetNodeId, as, nodeIdsToClone, contextualParentId === 'root' ? null : contextualParentId).then(() => {
            toast({ title: `Cloned ${clipboard.nodes?.length} node(s)`, description: `Pasted as clones.` });
            setClipboard({ nodes: null, operation: null });
            setSelectedNodeIds([]);
        });
    };


    if (selectedNodeIds.length === 0) {
        return null;
    }

    const handleDeleteSelection = () => {
        const nodeIdsToDelete = Array.from(new Set(selectedNodeIds.map(id => id.split('_')[0])));
        deleteNodes(selectedNodeIds);
        toast({ title: 'Deleted', description: `${selectedNodeIds.length} node instance(s) deleted.` });
    };
    
    const handleExpandAllSelection = () => {
        selectedNodeIds.forEach(instanceId => {
            const [nodeId, parentId] = instanceId.split('_');
            expandAllFromNode(nodeId, parentId === 'root' ? null : parentId);
        });
    };
    
    const handleCollapseAllSelection = () => {
        selectedNodeIds.forEach(instanceId => {
            const [nodeId, parentId] = instanceId.split('_');
            collapseAllFromNode(nodeId, parentId === 'root' ? null : parentId);
        });
    };
    
    const handlePreviewSelection = () => {
        const topLevelIds = getSelectedTopLevelNodes().map(n => n.node.id);
        if (topLevelIds.length > 0) {
            setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: topLevelIds });
        } else {
            toast({ variant: 'destructive', title: 'Preview Error', description: 'Could not find any top-level nodes in your selection to preview.' });
        }
    };

    const handleExport = (format: 'json' | 'archive' | 'html') => {
        const nodes = getSelectedTopLevelNodes().map(item => item.node);
        if (nodes.length === 0) {
            toast({ variant: 'destructive', title: 'Export Error', description: 'Could not find any top-level nodes in your selection to export.' });
            return;
        }

        const exportName = `${nodes.length}-nodes-export`;
        const exportTitle = `${nodes.length} Selected Nodes`;
        const exportId = 'export-container-selection';
        
        switch (format) {
            case 'json':
                exportNodesAsJson(nodes, exportName);
                break;
            case 'archive':
                exportNodesAsArchive(nodes, exportName);
                break;
            case 'html':
                setDialogState({ exportNodes: nodes, exportTitle, exportElementId: exportId });
                setTimeout(() => {
                    exportNodesAsHtml(exportId, nodes, exportTitle);
                    setDialogState({ exportNodes: undefined });
                }, 100);
                break;
        }
    };

    return (
        <Card className="fixed bottom-4 left-1/2 -translate-x-1/2 w-auto max-w-lg z-20 shadow-lg animate-in slide-in-from-bottom-2">
            <CardContent className="p-2">
                <div className="flex items-center gap-4">
                    <p className="text-sm font-medium">{selectedNodeIds.length} node{selectedNodeIds.length !== 1 && 's'} selected</p>
                    <div className="flex-grow border-l pl-2 flex items-center gap-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExpandAllSelection}><ChevronsUpDown/></Button></TooltipTrigger>
                                <TooltipContent><p>Expand All</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCollapseAllSelection}><ChevronsDownUp/></Button></TooltipTrigger>
                                <TooltipContent><p>Collapse All</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePreviewSelection}><Eye className="h-4 w-4" /></Button></TooltipTrigger>
                                <TooltipContent><p>Preview Selection</p></TooltipContent>
                            </Tooltip>
                             <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialogState({ isChangeTemplateMultipleOpen: true })}><RefreshCcw className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Change Template</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopySelection}><Copy className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Copy (Ctrl+C)</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCutSelection}><Scissors className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Cut (Ctrl+X)</p></TooltipContent>
                            </Tooltip>
                             <DropdownMenu>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="h-4 w-4"/></Button>
                                        </DropdownMenuTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Export Selection</p></TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onSelect={() => handleExport('json')}><FileJson className="mr-2 h-4 w-4" />JSON</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleExport('html')}><FileCode className="mr-2 h-4 w-4" />HTML</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleExport('archive')}><Archive className="mr-2 h-4 w-4" />Archive (.zip)</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <AlertDialog>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <AlertDialogTrigger asChild>
                                            <Button ref={deleteTriggerRef} variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4"/></Button>
                                        </AlertDialogTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Delete (Del)</p></TooltipContent>
                                </Tooltip>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                        <AlertDialogDescription>This will permanently delete {selectedNodeIds.length} selected node(s) and all their children. This action cannot be undone.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleDeleteSelection} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </TooltipProvider>
                    </div>
                     <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedNodeIds([])}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Clear selection</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </CardContent>
        </Card>
    );
}
