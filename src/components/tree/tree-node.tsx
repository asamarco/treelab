

/**
 * @fileoverview
 * This file defines the `TreeNodeComponent`, which is responsible for rendering a
 * single node in the tree structure. It's a recursive component that renders itself
 * for each of its children.
 *
 * It is composed of smaller sub-components to handle the header, content, and modals,
 * keeping the main component focused on layout and state.
 */
"use client";

import { useState, useEffect, useMemo, useRef, SetStateAction } from "react";
import { TreeNode } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Collapsible } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "../ui/card";
import { TreeNodeHeader } from "./tree-node-header";
import { TreeNodeContent } from "./tree-node-content";
import { TreeNodeModals } from "./tree-node-modals";
import { TreeNodeDropZone } from "./tree-node-dropzone";
import type { WritableDraft } from "immer";
import { AlertTriangle, Trash2, RefreshCcw } from "lucide-react";
import { Button } from "../ui/button";
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


interface TreeNodeProps {
  node: TreeNode;
  level: number;
  siblings: TreeNode[];
  onSelect: (instanceId: string, isShiftClick: boolean, isCtrlClick: boolean) => void;
  // This helps identify which parent this instance belongs to in the UI
  contextualParentId: string | null;
  overrideExpandedIds?: string[];
  onExpandedChange?: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
}

export function TreeNodeComponent({
  node,
  level,
  siblings,
  onSelect,
  contextualParentId,
  overrideExpandedIds,
  onExpandedChange,
}: TreeNodeProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const { dialogState, setDialogState, ignoreClicksUntil } = useUIContext();
  const nodeCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  const {
    getTemplateById,
    clipboard,
    expandedNodeIds: globalExpandedNodeIds,
    setExpandedNodeIds: setGlobalExpandedNodeIds,
    selectedNodeIds,
    deleteNode,
  } = useTreeContext();
  const { isCompactView } = useUIContext();

  const instanceId = `${node.id}_${contextualParentId || 'root'}`;
  
  const getActiveModal = (): null | 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate' => {
    if (dialogState.nodeInstanceIdForAction !== instanceId) return null;
    if (dialogState.isNodeEditOpen) return 'edit';
    if (dialogState.isAddChildOpen) return 'addChild';
    if (dialogState.isAddSiblingOpen) return 'addSibling';
    if (dialogState.isChangeTemplateOpen) return 'changeTemplate';
    if (dialogState.isPasteTemplateOpen) return 'pasteTemplate';
    return null;
  };
  
  const activeModal = getActiveModal();

  const setModalOpen = (modal: null | 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate') => {
    if (modal === 'edit') setDialogState({ isNodeEditOpen: true, nodeInstanceIdForAction: instanceId });
    else if (modal === 'addChild') setDialogState({ isAddChildOpen: true, nodeInstanceIdForAction: instanceId });
    else if (modal === 'addSibling') setDialogState({ isAddSiblingOpen: true, nodeInstanceIdForAction: instanceId });
    else if (modal === 'changeTemplate') setDialogState({ isChangeTemplateOpen: true, nodeInstanceIdForAction: instanceId });
    else if (modal === 'pasteTemplate') setDialogState({ isPasteTemplateOpen: true, nodeInstanceIdForAction: instanceId });
    else {
        // Close all modals associated with this instance
        setDialogState({ 
            isNodeEditOpen: false, 
            isAddChildOpen: false, 
            isAddSiblingOpen: false,
            isChangeTemplateOpen: false,
            isPasteTemplateOpen: false,
            nodeInstanceIdForAction: undefined 
        });
    }
  };


  const expandedNodeIds = overrideExpandedIds || globalExpandedNodeIds;
  const setExpandedNodeIds = onExpandedChange || setGlobalExpandedNodeIds;

  const expandedNodeIdSet = useMemo(() => new Set(expandedNodeIds), [expandedNodeIds]);
  const isSelected = useMemo(() => selectedNodeIds.includes(instanceId), [selectedNodeIds, instanceId]);
  const isExpanded = expandedNodeIdSet.has(instanceId);

  const template = getTemplateById(node.templateId);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: instanceId, // Make ID unique per instance
    data: {
        nodeId: node.id,
        parentId: contextualParentId,
    },
    disabled: !isMounted
  });

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `node_${instanceId}`,
  });

  const setNodeRef = (el: HTMLDivElement | null) => {
    setDraggableNodeRef(el);
    setDroppableNodeRef(el);
    (nodeCardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };

  const style = {
    transform: CSS.Translate.toString(transform),
  };
  
  const isCut = clipboard.operation === 'cut' && !!clipboard.nodes?.some(
    n => n.id === node.id && n.parentIds.includes(contextualParentId!)
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.read-only-view')) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setIsMenuOpen(true);
  };
  
  if (!template) {
    return (
      <div style={{ paddingLeft: `${level * 1.5}rem` }} className="pl-6 my-1">
        <Card className="border-destructive/50 bg-destructive/10 w-full">
          <CardContent className="p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div className="text-sm">
                <p className="font-semibold text-destructive">{node.name}</p>
                <p className="text-destructive/80">Template missing or deleted.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setModalOpen('changeTemplate')}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Change Template
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this node and all its children.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteNode(node.id, contextualParentId)}
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
        <TreeNodeModals
          node={node}
          template={{ id: '', name: 'Missing', fields: [], conditionalRules: [] }} // Dummy template
          openModal={activeModal}
          onOpenChange={setModalOpen}
          contextualParentId={contextualParentId}
        />
      </div>
    );
  }

  const uniqueCardId = `node-card-${instanceId}`;

  return (
    <div
      className={cn(
        "relative pl-6 transition-opacity",
        isCut && "opacity-50"
      )}
      style={{ zIndex: isDragging ? 100 : "auto" }}
      onContextMenu={handleContextMenu}
    >
      <div
        className={cn(
            "absolute left-0 top-[2.5rem] h-[calc(100%-2.5rem)] w-px bg-border -translate-x-3",
            "group-last/treenode:hidden",
            (isExpanded || !node.children || node.children.length === 0) && "hidden",
            isCompactView && "hidden"
        )}
      />
      <Card
        id={uniqueCardId}
        ref={setNodeRef}
        style={style}
        className={cn(
          "bg-card/60 transition-all my-1 cursor-pointer",
          isSelected && "border-primary ring-2 ring-primary ring-offset-2",
          isDragging && "shadow-xl opacity-80",
          isOver && "outline-2 outline-dashed outline-primary"
        )}
        onClick={(e) => {
            if (Date.now() < ignoreClicksUntil) {
              e.stopPropagation();
              return;
            }
            e.stopPropagation();
            onSelect(instanceId, e.shiftKey, e.ctrlKey || e.metaKey);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.read-only-view')) return;
          
          const isAnyModalOpen = Object.values(dialogState).some(state => state === true);
          if (isAnyModalOpen) {
            return;
          }

          e.stopPropagation();
          setModalOpen('edit');
        }}
      >
        <CardContent className="p-1">
          <Collapsible open={isExpanded}>
            <TreeNodeHeader
              node={node}
              template={template}
              isExpanded={isExpanded}
              isSelected={isSelected}
              siblings={siblings}
              onSelect={onSelect}
              onOpenModal={setModalOpen}
              dndAttributes={attributes}
              dndListeners={listeners}
              contextualParentId={contextualParentId}
              isMenuOpen={isMenuOpen}
              onMenuOpenChange={setIsMenuOpen}
              contextMenuPosition={contextMenuPosition}
            />
            <TreeNodeContent 
              node={node} 
              template={template} 
              isExpanded={isExpanded}
              level={level}
              onSelect={onSelect}
              contextualParentId={node.id}
              overrideExpandedIds={overrideExpandedIds}
              onExpandedChange={setExpandedNodeIds}
            />
          </Collapsible>
        </CardContent>
      </Card>
      <TreeNodeModals
        node={node}
        template={template}
        openModal={activeModal}
        onOpenChange={setModalOpen}
        contextualParentId={contextualParentId}
      />
    </div>
  );
}

