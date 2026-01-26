

/**
 * @fileoverview
 * This component renders the interactive header of a single tree node.
 * It includes the selection checkbox, drag handle, expand/collapse trigger,
 * icon, name, and a dropdown menu with various actions.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TreeNode, Template } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import {
  ChevronRight, Plus, Trash2, Edit, MoreHorizontal, GripVertical, Copy, Scissors,
  ClipboardPaste, ArrowUp, ArrowDown, FileText, ChevronsDownUp, ChevronsUpDown,
  Star, RefreshCcw, Paperclip, ClipboardPlus, ClipboardList, Sheet,
  Download, FileJson, Archive, FileCode, Check, Eye, Redo2, Link as LinkIcon, ListOrdered,
  CornerDownRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { CollapsibleTrigger } from "../ui/collapsible";
import { Icon } from "../icon";
import { icons } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "../ui/alert-dialog";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getConditionalStyle, hasAttachments } from "./tree-node-utils";
import { HtmlExportView } from "./html-export-view";
import { useAuthContext } from "@/contexts/auth-context";
import { WritableDraft } from "immer";

interface TreeNodeHeaderProps {
  node: TreeNode;
  template: Template;
  isExpanded: boolean;
  isSelected: boolean;
  siblings: TreeNode[];
  onSelect: (nodeId: string, isShiftClick: boolean, isCtrlClick: boolean) => void;
  onOpenModal: (modal: 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate') => void;
  dndAttributes: any;
  dndListeners: any;
  contextualParentId: string | null;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  contextMenuPosition: { x: number; y: number } | null;
  onExpandedChange: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
}

export function TreeNodeHeader({
  node,
  template,
  isExpanded,
  isSelected,
  siblings,
  onSelect,
  onOpenModal,
  dndAttributes,
  dndListeners,
  contextualParentId,
  isMenuOpen,
  onMenuOpenChange,
  contextMenuPosition,
  onExpandedChange,
}: TreeNodeHeaderProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuthContext();
  const { isCompactView, showNodeOrder, setDialogState } = useUIContext();
  const {
    clipboard, setClipboard, findNodeAndParent, setExpandedNodeIds, expandAllFromNode,
    collapseAllFromNode, updateNode, deleteNode, moveNodeOrder, moveNodes,
    pasteNodes, getNodeInstancePaths,
    exportNodesAsArchive, exportNodesAsHtml, exportNodesAsJson, getTemplateById,
    getSiblingOrderRange,
    setSelectedNodeIds,
    pasteNodesAsClones,
  } = useTreeContext();

  const [nodesForHtmlExport, setNodesForHtmlExport] = useState<TreeNode[] | null>(null);

  const instanceId = `${node.id}_${contextualParentId || 'root'}`;
  const { icon, color } = getConditionalStyle(node, template);
  const nodeHasAttachments = hasAttachments(node, template);
  
  // A node is a clone if it has more than one parent.
  // The parentIds array is now authoritative from the database via buildTreeHierarchy.
  const isClone = Array.isArray(node.parentIds) && node.parentIds.length > 1;

  const clonePaths = isClone ? getNodeInstancePaths(node.id) : [];
  
  const parentIndex = contextualParentId ? (node.parentIds || []).indexOf(contextualParentId) : (node.parentIds || []).indexOf('root');
  const contextualOrder = (parentIndex !== -1 && node?.order && (node.order.length > parentIndex))
    ? node.order[parentIndex]
    : siblings.findIndex(s => s.id === node.id);

  const { minOrder, maxOrder } = getSiblingOrderRange(siblings, contextualParentId);


  const hasContentToToggle =
    (node.children && node.children.length > 0) ||
    nodeHasAttachments ||
    template.fields.some(f => f.type === 'picture' && node.data[f.id] && node.data[f.id].length > 0) ||
    template.fields.some(f => f.type === 'table-header') ||
    template.fields.some(f => f.type === 'xy-chart') ||
    template.fields.some(f => f.type === 'query') ||
    (template.bodyTemplate && template.bodyTemplate.trim() !== '');


  const handleCopy = () => {
    // IMPORTANT: Always get the full node from the context, not the filtered `node` prop,
    // to ensure all children are included in the copy.
    const fullNode = findNodeAndParent(node.id)?.node;
    if (!fullNode) {
        toast({ variant: 'destructive', title: 'Copy Failed', description: 'Could not find the node to copy.' });
        return;
    }
    setClipboard({ nodes: [fullNode], operation: "copy" });
    toast({ title: 'Copied', description: '1 node and its children copied to clipboard.' });
  };

  const handleCut = () => {
    setClipboard({ nodes: [{ ...node, parentIds: [contextualParentId!] }], operation: "cut" });
    toast({ title: 'Cut', description: '1 node instance cut to clipboard.' });
  };
  
  const handleCopyLink = () => {
    const link = `node://${node.id}`;
    navigator.clipboard.writeText(link);
    toast({ title: 'Link Copied', description: 'Node link copied to clipboard.' });
  };

  const handlePaste = async (as: 'child' | 'sibling') => {
    if (!clipboard.nodes) return;
  
    if (clipboard.operation === 'cut') {
      let moves = clipboard.nodes.map(sourceNode => ({
        nodeId: sourceNode.id,
        targetNodeId: node.id,
        position: as,
        sourceContextualParentId: sourceNode.parentIds[0] ?? null,
        targetContextualParentId: contextualParentId,
        isCutOperation: true,
      }));
  
      if (as === 'sibling') {
        moves = moves.reverse();
      }
  
      await moveNodes(moves);
    } else {
      await pasteNodes(node.id, as, contextualParentId);
    }
  
    // Clear clipboard and selection after paste
    setClipboard({ nodes: null, operation: null });
    setSelectedNodeIds([]);
  };
  
  

  const handlePasteAsClone = (as: 'child' | 'sibling') => {
    if (!clipboard.nodes || clipboard.operation === 'cut') return;

    const nodeIdsToClone = clipboard.nodes.map(n => n.id);
    pasteNodesAsClones(node.id, as, nodeIdsToClone, contextualParentId).then(() => {
        toast({ title: `Cloned ${clipboard.nodes?.length} node(s)`, description: `Pasted as clones.` });
        setClipboard({ nodes: null, operation: null });
        setSelectedNodeIds([]);
    });
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

  const handleHtmlExport = () => {
    if (!currentUser) {
        handlePublicExportClick();
        return;
    }
    setNodesForHtmlExport([node]);
    setTimeout(() => {
        exportNodesAsHtml(`export-container-single-${node.id}`, [node], node.name);
        setNodesForHtmlExport(null);
    }, 100);
  };
  
  const handleArchiveExport = () => {
      if (!currentUser) {
          handlePublicExportClick();
          return;
      }
      exportNodesAsArchive([node], `${node.name}_archive`);
  };

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          className="fixed"
          style={{
            left: contextMenuPosition?.x,
            top: contextMenuPosition?.y,
          }}
        />
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => router.push(`/templates?edit=${template.id}`)}>
              <Edit className="mr-2 h-4 w-4" /> Edit Template
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenModal('changeTemplate')}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Change Template
            </DropdownMenuItem>
            <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                    <Download className="mr-2 h-4 w-4" />
                    <span>Export As...</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => exportNodesAsJson([node], node.name)}><FileJson className="mr-2 h-4 w-4" />JSON</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleHtmlExport} disabled={!currentUser}><FileCode className="mr-2 h-4 w-4" />HTML</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleArchiveExport} disabled={!currentUser}><Archive className="mr-2 h-4 w-4" />Archive (.zip)</DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCopy}>
              <Copy className="mr-2 h-4 w-4" /> Copy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleCut}>
              <Scissors className="mr-2 h-4 w-4" /> Cut
            </DropdownMenuItem>
             <DropdownMenuItem onSelect={handleCopyLink}>
              <LinkIcon className="mr-2 h-4 w-4" /> Copy Link
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!clipboard.nodes}>
                <ClipboardPaste className="mr-2 h-4 w-4" />
                <span>Paste</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => handlePaste('child')} disabled={!clipboard.nodes}>
                    <ClipboardPlus className="mr-2 h-4 w-4" /> Paste as child
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handlePaste('sibling')} disabled={!clipboard.nodes}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Paste as sibling
                  </DropdownMenuItem>
                  <DropdownMenuSeparator/>
                   <DropdownMenuItem onSelect={() => handlePasteAsClone('child')} disabled={!clipboard.nodes || clipboard.operation === 'cut'}>
                    <ClipboardPlus className="mr-2 h-4 w-4 text-primary" /> Paste as clone (child)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handlePasteAsClone('sibling')} disabled={!clipboard.nodes || clipboard.operation === 'cut'}>
                    <ClipboardList className="mr-2 h-4 w-4 text-primary" /> Paste as clone (sibling)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem onSelect={() => onOpenModal('pasteTemplate')} disabled={!clipboard.nodes || clipboard.operation === 'cut'}>
                    <Sheet className="mr-2 h-4 w-4" /> Paste Template
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>This action will permanently delete this instance of the "{node.name}" node. If this is the last instance, the node and all its children will be deleted.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteNode(node.id, contextualParentId)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-start gap-1 group/treenode">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "cursor-grab shrink-0 no-print read-only-hidden transition-opacity opacity-0 group-hover/treenode:opacity-100", 
            isCompactView ? 'h-6 w-6' : 'h-8 w-8',
          )}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          {...dndAttributes}
          {...dndListeners}
        >
          <GripVertical className={cn(isCompactView ? 'h-3 w-3' : 'h-4 w-4')} />
        </Button>
        <div
          className="flex-1"
        >
          <div className="flex items-center gap-1">
            <CollapsibleTrigger asChild>
              <button
                onClick={(e) => {
                    e.stopPropagation();
                    onExpandedChange((prev: any) => {
                      const newSet = new Set(prev as string[]);
                      if (newSet.has(instanceId)) newSet.delete(instanceId); else newSet.add(instanceId);
                      return Array.from(newSet);
                    });
                }}
                aria-label="Toggle node"
                className={cn("p-1 rounded-md hover:bg-accent no-print", isCompactView && 'p-0.5', !hasContentToToggle && "invisible")}
              >
                <ChevronRight className={cn("h-4 w-4 transition-transform duration-200 shrink-0 no-print", isCompactView && 'h-3 w-3', isExpanded && "rotate-90")} />
              </button>
            </CollapsibleTrigger>
            <Icon name={(icon as keyof typeof icons) || "FileText"} className={cn("mr-2 h-5 w-5 shrink-0", isCompactView && "h-4 w-4 mr-1")} style={{ color: color || "hsl(var(--primary))" }} />
            <div className="flex-grow flex items-center gap-1">
              <p className={cn("font-semibold", isCompactView && "text-sm")}>
                {showNodeOrder && <span className="text-muted-foreground font-normal text-xs mr-1">{contextualOrder + 1}.</span>}
                {node.name}
              </p>
              {isClone && (
                 <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger onClick={(e) => e.stopPropagation()}>
                            <Copy className="h-3 w-3 text-muted-foreground ml-1 shrink-0 read-only-control" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="font-bold">This node is a clone. It also exists at:</p>
                            <ul className="list-disc pl-4 mt-1 space-y-1">
                                {clonePaths.map((path, index) => <li key={index}>{path}</li>)}
                            </ul>
                        </TooltipContent>
                    </Tooltip>
                 </TooltipProvider>
              )}
              {nodeHasAttachments && (<Paperclip className="h-3 w-3 text-muted-foreground ml-1 shrink-0" />)}
              <div className="flex items-center opacity-0 group-hover/treenode:opacity-100 transition-opacity read-only-control">
                <TooltipProvider>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [node.id] }); }}>
                            <Eye className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Preview Node (v)</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onOpenModal('edit'); }}>
                            <Edit className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Edit Node (e)</p></TooltipContent></Tooltip>
                    <div className="w-2"></div>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); if (isExpanded) { collapseAllFromNode([{ nodeId: node.id, parentId: contextualParentId }]); } else { expandAllFromNode([{ nodeId: node.id, parentId: contextualParentId }]); } }} disabled={!node.children || node.children.length === 0}>
                            <ChevronsUpDown className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>{isExpanded ? 'Collapse All (Ctrl+Left)' : 'Expand All (Ctrl+Right)'}</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); moveNodeOrder(node.id, 'up', contextualParentId); }} disabled={contextualOrder === minOrder}>
                            <ArrowUp className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Move Up (i)</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); moveNodeOrder(node.id, 'down', contextualParentId); }} disabled={contextualOrder === maxOrder}>
                            <ArrowDown className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Move Down (k)</p></TooltipContent></Tooltip>
                    <div className="w-2"></div>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onOpenModal('addChild'); }}>
                            <CornerDownRight className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Add Child (Enter)</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onOpenModal('addSibling'); }}>
                            <Plus className="h-3 w-3" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Add Sibling (+)</p></TooltipContent></Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
          {!isExpanded && node.children && node.children.length > 0 && !isCompactView && (
            <div className="pl-6 pt-1 flex items-center gap-2 overflow-hidden text-muted-foreground text-xs">
                {node.children.slice(0, 5).map((child, index) => {
                    const childTemplate = getTemplateById(child.templateId);
                    const { icon: childIcon, color: childColor } = getConditionalStyle(child, childTemplate);
                    if (!childTemplate) return null;
                    return (
                        <div key={`${child.id}-${index}`} className="flex items-center gap-1 shrink-0">
                           <Icon name={childIcon as keyof typeof icons || 'FileText'} className="h-3 w-3" style={{ color: childColor || 'hsl(var(--foreground))' }} />
                           <span>{child.name}</span>
                        </div>
                    );
                })}
                {node.children.length > 5 && (
                    <span className="shrink-0">...and {node.children.length - 5} more</span>
                )}
            </div>
           )}
        </div>
        <div className="flex items-center ml-auto read-only-control" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className={cn("h-7 w-7 transition-colors no-print", isCompactView && "h-6 w-6")} onClick={(e) => { e.stopPropagation(); updateNode(node.id, { isStarred: !node.isStarred }); }}>
                        <Star className={cn("h-4 w-4 no-print", node.isStarred ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground/50 hover:text-muted-foreground")} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent><p>{node.isStarred ? 'Unstar' : 'Star'} (*)</p></TooltipContent>
              </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {nodesForHtmlExport && (
        <div id={`export-container-single-${node.id}`} className="hidden">
            <HtmlExportView
                nodes={nodesForHtmlExport}
                title={node.name}
                getTemplateById={getTemplateById}
                imageMap={new Map()}
                attachmentsMap={new Map()}
                currentUser={currentUser}
            />
        </div>
      )}
    </>
  );
}
