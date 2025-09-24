

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
        exportNodesAsArchive,
        exportNodesAsHtml,
        exportNodesAsJson,
        getTemplateById,
        clipboard,
        pasteNodes,
        moveNodes,
        pasteNodesAsClones,
        expandAllFromNode,
        collapseAllFromNode,
        toggleStarredForSelectedNodes,
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
    
    const handlePreviewSelection = useCallback(() => {
        const topLevelIds = getSelectedTopLevelNodes().map(n => n.node.id);
        if (topLevelIds.length > 0) {
            setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: topLevelIds });
        } else {
            toast({ variant: 'destructive', title: 'Preview Error', description: 'Could not find any top-level nodes in your selection to preview.' });
        }
    }, [getSelectedTopLevelNodes, setDialogState, toast]);

    const handleExpandAllSelection = useCallback(() => {
        selectedNodeIds.forEach(instanceId => {
            const [nodeId, parentId] = instanceId.split('_');
            expandAllFromNode(nodeId, parentId === 'root' ? null : parentId);
        });
    }, [selectedNodeIds, expandAllFromNode]);

    const handleCollapseAllSelection = useCallback(() => {
        selectedNodeIds.forEach(instanceId => {
            const [nodeId, parentId] = instanceId.split('_');
            collapseAllFromNode(nodeId, parentId === 'root' ? null : parentId);
        });
    }, [selectedNodeIds, collapseAllFromNode]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
          const activeElement = document.activeElement as HTMLElement;
          if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
            return;
          }

          if (event.key === '*') {
            if (selectedNodeIds.length === 0) return;
            event.preventDefault();
            toggleStarredForSelectedNodes();
            return;
          }

          if (event.ctrlKey || event.metaKey) {
            if (event.key === 'c') {
              if (selectedNodeIds.length === 0) return;
              event.preventDefault();
              handleCopySelection();
            } else if (event.key === 'x') {
              if (selectedNodeIds.length === 0) return;
              event.preventDefault();
              handleCutSelection();
            } else if (event.key === 'v') {
              event.preventDefault();
              if (selectedNodeIds.length !== 1 || !clipboard.nodes) return;
              
              const targetInstanceId = selectedNodeIds[0];
              const [targetNodeId, contextualParentId] = targetInstanceId.split('_');
              
              if (event.altKey) { // Paste as Clone: CTRL+ALT+V
                if (clipboard.operation === 'cut') return;
                const nodeIdsToClone = clipboard.nodes.map(n => n.id);
                pasteNodesAsClones(targetNodeId, 'child', nodeIdsToClone, contextualParentId === 'root' ? null : contextualParentId).then(() => {
                    toast({ title: `Cloned ${clipboard.nodes?.length} node(s)`, description: `Pasted as clones.` });
                    setClipboard({ nodes: null, operation: null });
                    setSelectedNodeIds([]);
                });
              } else { // Standard Paste: CTRL+V
                  if (clipboard.operation === 'cut') {
                    const moves = clipboard.nodes.map(sourceNode => ({
                        nodeId: sourceNode.id,
                        targetNodeId: targetNodeId,
                        position: 'child' as 'child' | 'sibling',
                        sourceContextualParentId: sourceNode.parentIds[0] ?? null,
                        targetContextualParentId: contextualParentId === 'root' ? null : contextualParentId,
                        isCutOperation: true,
                    }));
                    moveNodes(moves);
                  } else {
                    pasteNodes(targetNodeId, 'child', contextualParentId === 'root' ? null : contextualParentId);
                  }
                  setClipboard({ nodes: null, operation: null });
                  setSelectedNodeIds([]);
              }
            } 
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedNodeIds.length === 0) return;
            event.preventDefault();
            deleteTriggerRef.current?.click();
          } else if (event.key === 'v') {
              if (selectedNodeIds.length === 0) return;
              event.preventDefault();
              handlePreviewSelection();
          } else if (event.key === 't' || event.key === 'T') {
              if (selectedNodeIds.length === 0) return;
              event.preventDefault();
              setDialogState({ isChangeTemplateMultipleOpen: true });
          }
        };
    
        window.addEventListener('keydown', handleKeyDown);
        return () => {
          window.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedNodeIds, clipboard, handleCopySelection, handleCutSelection, pasteNodes, moveNodes, pasteNodesAsClones, setClipboard, setSelectedNodeIds, toast, handlePreviewSelection, setDialogState, handleExpandAllSelection, handleCollapseAllSelection, toggleStarredForSelectedNodes]);

    if (selectedNodeIds.length === 0) {
        return null;
    }

    const handleDeleteSelection = () => {
        const nodeIdsToDelete = Array.from(new Set(selectedNodeIds.map(id => id.split('_')[0])));
        deleteNodes(selectedNodeIds);
        toast({ title: 'Deleted', description: `${selectedNodeIds.length} node instance(s) deleted.` });
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
        <Card className="fixed bottom-4 left-1/2 -translate-x-1/2 w-auto max-w-lg z-20 shadow-lg animate-in slide-in-from-bottom-2 read-only-control">
            <CardContent className="p-2">
                <div className="flex items-center gap-4">
                    <p className="text-sm font-medium">{selectedNodeIds.length} node{selectedNodeIds.length !== 1 && 's'} selected</p>
                    <div className="flex-grow border-l pl-2 flex items-center gap-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePreviewSelection}><Eye className="h-4 w-4" /></Button></TooltipTrigger>
                                <TooltipContent><p>Preview Selection (v)</p></TooltipContent>
                            </Tooltip>
                             <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialogState({ isChangeTemplateMultipleOpen: true })}><RefreshCcw className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Change Template (t)</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopySelection}><Copy className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Copy (Ctrl+C)</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCutSelection}><Scissors className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Cut (Ctrl+X)</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExpandAllSelection}><ChevronsDownUp className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Expand All</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCollapseAllSelection}><ChevronsUpDown className="h-4 w-4"/></Button></TooltipTrigger>
                                <TooltipContent><p>Collapse All</p></TooltipContent>
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
