/**
 * @fileoverview
 * This component renders the interactive header of a single tree node.
 * It includes the selection checkbox, drag handle, expand/collapse trigger,
 * icon, name, and a dropdown menu with various actions.
 * Optimized for IDE interactions in Explorer mode.
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
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "../ui/alert-dialog";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getConditionalStyle, hasAttachments } from "./tree-node-utils";
import { HtmlExportView } from "./html-export-view";
import { useAuthContext } from "@/contexts/auth-context";
import { WritableDraft } from "immer";
import { useIsMobile } from "@/hooks/use-mobile";

interface TreeNodeHeaderProps {
  node: TreeNode;
  template: Template;
  isExpanded: boolean;
  isSelected: boolean;
  siblings: TreeNode[];
  onSelect: (instanceId: string, isShiftClick: boolean, isCtrlClick: boolean) => void;
  onOpenModal: (modal: 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate') => void;
  dndAttributes: any;
  dndListeners: any;
  contextualParentId: string | null;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  contextMenuPosition: { x: number; y: number } | null;
  onExpandedChange: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
  isCompactOverride?: boolean;
  isExplorer?: boolean;
  readOnly?: boolean;
  disableSelection?: boolean;
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
  isCompactOverride,
  isExplorer = false,
  readOnly = false,
  disableSelection = false,
}: TreeNodeHeaderProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuthContext();
  const { isCompactView: globalIsCompactView, showNodeOrder, setDialogState } = useUIContext();
  const isMobile = useIsMobile();
  
  const isCompactView = isCompactOverride ?? globalIsCompactView;

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
  
  const isClone = Array.isArray(node.parentIds) && node.parentIds.length > 1;
  const clonePaths = isClone ? getNodeInstancePaths(node.id) : [];
  
  const parentIndex = contextualParentId ? (node.parentIds || []).indexOf(contextualParentId) : (node.parentIds || []).indexOf('root');
  const contextualOrder = (parentIndex !== -1 && node?.order && (node.order.length > parentIndex))
    ? node.order[parentIndex]
    : siblings.findIndex(s => s.id === node.id);

  const { minOrder, maxOrder } = getSiblingOrderRange(siblings, contextualParentId);

  const hasContentToToggle =
    (node.children && node.children.length > 0) ||
    (!isCompactOverride && (
      nodeHasAttachments ||
      template.fields.some(f => f.type === 'picture' && node.data[f.id] && node.data[f.id].length > 0) ||
      template.fields.some(f => f.type === 'table-header') ||
      template.fields.some(f => f.type === 'xy-chart') ||
      template.fields.some(f => f.type === 'query') ||
      template.fields.some(f => f.type === 'checkbox') ||
      template.fields.some(f => f.type === 'checklist') ||
      (template.bodyTemplate && template.bodyTemplate.trim() !== '')
    ));

  const handleCopy = () => {
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

  const handleToggleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(node.id, { isStarred: !node.isStarred });
  };

  const isHandleHidden = isMobile || readOnly || disableSelection || isExplorer;

  return (
    <>
      {!readOnly && (
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
      )}

      <div className="flex items-start gap-0.5 group/treenode">
        {!isExplorer && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "shrink-0 no-print read-only-hidden transition-opacity cursor-grab", 
              isCompactView ? 'h-7 w-7' : 'h-8 w-8 mt-1',
              isHandleHidden && 'hidden',
              !isMobile && "opacity-0 group-hover/treenode:opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            {...dndAttributes}
            {...dndListeners}
          >
            <GripVertical className={cn(isCompactView ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <div className={cn("flex items-start gap-1", isMobile && "py-2 min-h-[3.5rem]")}>
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
                className={cn(
                  "flex items-center justify-center rounded-md hover:bg-accent no-print shrink-0", 
                  isCompactView ? 'h-7 w-7' : 'h-8 w-8 mt-1',
                  (!hasContentToToggle && !isExplorer) && "invisible", 
                  isMobile && "h-10 w-10",
                  isExplorer && "cursor-grab"
                )}
                {...(isExplorer ? dndAttributes : {})}
                {...(isExplorer ? dndListeners : {})}
              >
                {hasContentToToggle ? (
                  <ChevronRight className={cn("h-4 w-4 transition-transform duration-200 no-print", isCompactView && 'h-3.5 w-3.5', isExpanded && "rotate-90", isMobile && "h-5 w-5")} />
                ) : isExplorer ? (
                  <div className="w-4 h-4" />
                ) : null}
              </button>
            </CollapsibleTrigger>
            <Icon 
              name={(icon as keyof typeof icons) || "FileText"} 
              className={cn("mr-2 h-5 w-5 shrink-0", isCompactView ? "h-4 w-4 mt-1.5 ml-3" : "h-5 w-5 mt-2.5")} 
              style={{ color: color || "hsl(var(--primary))" }} 
            />
            <div className="flex-grow flex items-start gap-1 min-w-0 py-1.5 md:py-1">
              <p className={cn("font-semibold break-words whitespace-normal leading-tight", isCompactView && "text-sm mt-0.5", !isCompactView && "mt-1", isMobile && "text-base mt-1.5")}>
                {showNodeOrder && <span className="text-muted-foreground font-normal text-xs mr-1">{contextualOrder + 1}.</span>}
                {node.name}
              </p>
              {isExplorer && node.isStarred && (
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-500 ml-1 mt-1 shrink-0" />
              )}
              {isClone && (
                 <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger onClick={(e) => e.stopPropagation()}>
                            <Copy className="h-3 w-3 text-muted-foreground ml-1 mt-1 shrink-0 read-only-control" />
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
              {nodeHasAttachments && !isCompactOverride && (<Paperclip className="h-3 w-3 text-muted-foreground ml-1 mt-1 shrink-0" />)}
              
              {!readOnly && (isCompactOverride || isMobile) && (
                <div className="flex items-center gap-1 opacity-0 group-hover/treenode:opacity-100 transition-opacity ml-1 mt-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [node.id] })}>
                        <Eye className="mr-2 h-4 w-4" /> Preview
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onOpenModal('edit')}>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onOpenModal('addChild')}>
                        <CornerDownRight className="mr-2 h-4 w-4" /> Add Child
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onOpenModal('addSibling')}>
                        <Plus className="mr-2 h-4 w-4" /> Add Sibling
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => { if (isExpanded) collapseAllFromNode([{ nodeId: node.id, parentId: contextualParentId }]); else expandAllFromNode([{ nodeId: node.id, parentId: contextualParentId }]); }} disabled={!node.children || node.children.length === 0}>
                        <ChevronsUpDown className="mr-2 h-4 w-4" /> {isExpanded ? 'Collapse All' : 'Expand All'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => moveNodeOrder(node.id, 'up', contextualParentId)} disabled={contextualOrder === minOrder}>
                        <ArrowUp className="mr-2 h-4 w-4" /> Move Up
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => moveNodeOrder(node.id, 'down', contextualParentId)} disabled={contextualOrder === maxOrder}>
                        <ArrowDown className="mr-2 h-4 w-4" /> Move Down
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {!isMobile && !isCompactOverride && !readOnly && (
                <div className="flex items-center opacity-0 group-hover/treenode:opacity-100 transition-opacity read-only-control mt-0.5">
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
              )}
            </div>
          </div>
          {!isExpanded && node.children && node.children.length > 0 && !isCompactView && !isMobile && (
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
        <div className="flex items-center ml-auto pl-2 read-only-control mt-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {!readOnly && !isExplorer && (
            <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className={cn("h-7 w-7 transition-colors no-print", isCompactView && "h-6 w-6", isMobile && "h-10 w-10")} onClick={handleToggleStar}>
                          <Star className={cn("h-4 w-4 no-print", node.isStarred ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground/50 hover:text-muted-foreground", isMobile && "h-5 w-5")} />
                      </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>{node.isStarred ? 'Unstar' : 'Star'} (*)</p></TooltipContent>
                </Tooltip>
            </TooltipProvider>
          )}
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
