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

import { useState, useEffect, useMemo, useRef } from "react";
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
import { AlertTriangle, Trash2, RefreshCcw, GripVertical } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";


interface TreeNodeProps {
  node: TreeNode;
  level: number;
  siblings: TreeNode[];
  onSelect: (instanceId: string, isShiftClick: boolean, isCtrlClick: boolean) => void;
  contextualParentId: string | null;
  overrideExpandedIds?: string[];
  onExpandedChange?: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
  isCompactOverride?: boolean;
  isExplorer?: boolean;
  readOnly?: boolean;
  disableSelection?: boolean;
}

export function TreeNodeComponent({
  node,
  level,
  siblings,
  onSelect,
  contextualParentId,
  overrideExpandedIds,
  onExpandedChange,
  isCompactOverride,
  isExplorer,
  readOnly = false,
  disableSelection = false,
}: TreeNodeProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const { dialogState, setDialogState, ignoreClicksUntil } = useUIContext();
  const nodeCardRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();

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
  const { isCompactView: globalIsCompactView } = useUIContext();

  const isCompactView = isCompactOverride ?? globalIsCompactView;

  const instanceId = `${node.id}_${contextualParentId || 'root'}`;

  const expandedNodeIds = overrideExpandedIds || globalExpandedNodeIds;
  const setExpandedNodeIds = (onExpandedChange || setGlobalExpandedNodeIds) as unknown as (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;

  const expandedNodeIdSet = useMemo(() => new Set(expandedNodeIds), [expandedNodeIds]);
  const isSelected = useMemo(() => !readOnly && !disableSelection && selectedNodeIds.includes(instanceId), [selectedNodeIds, instanceId, readOnly, disableSelection]);
  const isExpanded = expandedNodeIdSet.has(instanceId);

  const template = getTemplateById(node.templateId);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: instanceId,
    data: {
      nodeId: node.id,
      parentId: contextualParentId,
    },
    disabled: !isMounted || isMobile || readOnly || disableSelection // In Explorer mode, the Chevron button will use the listeners
  });

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `node_${instanceId}`,
    disabled: readOnly || disableSelection,
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
    if ((e.target as HTMLElement).closest('.read-only-view') || readOnly) return;

    // Allow browser context menu on images
    if ((e.target as HTMLElement).tagName === 'IMG') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setIsMenuOpen(true);
  };

  const handleOpenModal = (modalType: 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate') => {
    setDialogState({ [modalType === 'addChild' ? 'isAddChildOpen' : modalType === 'addSibling' ? 'isAddSiblingOpen' : modalType === 'edit' ? 'isNodeEditOpen' : modalType === 'changeTemplate' ? 'isChangeTemplateOpen' : 'isPasteTemplateOpen']: true, nodeInstanceIdForAction: instanceId });
  };

  if (!template) {
    return (
      <div className={cn("my-1", isCompactView ? "pl-0" : "pl-0")}>
        <Card className="border-destructive/50 bg-destructive/10 w-full rounded-md">
          <CardContent className="p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div className="text-sm">
                <p className="font-semibold text-destructive">{node.name}</p>
                <p className="text-destructive/80">Template missing or deleted.</p>
              </div>
            </div>
            <div className="flex gap-2">
              {!readOnly && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => handleOpenModal('changeTemplate')}>
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
                </>
              )}
            </div>
          </CardContent>
        </Card>
        {!readOnly && (
          <TreeNodeModals
            node={node}
            template={{ id: '', name: 'Missing', fields: [], conditionalRules: [] } as any}
          />
        )}
      </div>
    );
  }

  const uniqueCardId = `node-card-${instanceId}`;

  return (
    <div
      className={cn(
        "relative transition-opacity",
        isExplorer ? "pl-0 pr-0 py-0 my-0 leading-none" : (isCompactView ? "pl-0 pr-1" : "pl-0 pr-1"),
        isCut && "opacity-50"
      )}
      style={{ zIndex: isDragging ? 100 : "auto" }}
      onContextMenu={handleContextMenu}
    >
      <Card
        id={uniqueCardId}
        ref={setNodeRef}
        style={style}
        className={cn(
          "bg-card/60 transition-all rounded-md overflow-hidden",
          isCompactView ? "my-0.5 border-0 shadow-none hover:bg-accent/30" : (isExplorer ? "my-0 border-0 shadow-none hover:bg-accent/50 rounded-none w-full" : "my-1"),
          (!readOnly && !disableSelection) && "cursor-pointer",
          isSelected && "border-primary ring-2 ring-primary ring-offset-2 z-10",
          isDragging && "shadow-xl opacity-80",
          isOver && "outline-2 outline-dashed outline-primary"
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (Date.now() < ignoreClicksUntil || readOnly || disableSelection) {
            return;
          }
          onSelect(instanceId, e.shiftKey, e.ctrlKey || e.metaKey);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.read-only-view') || readOnly) return;

          const isAnyModalOpen = Object.values(dialogState).some(state => state === true);
          if (isAnyModalOpen) {
            return;
          }

          e.stopPropagation();
          handleOpenModal('edit');
        }}
      >
        <CardContent className={cn("p-1", isCompactView && "p-0")}>
          <Collapsible open={isExpanded}>
            <TreeNodeHeader
              node={node}
              template={template}
              isExpanded={isExpanded}
              isSelected={isSelected}
              siblings={siblings}
              onSelect={onSelect}
              onOpenModal={handleOpenModal}
              dndAttributes={attributes}
              dndListeners={listeners}
              contextualParentId={contextualParentId}
              isMenuOpen={isMenuOpen}
              onMenuOpenChange={setIsMenuOpen}
              contextMenuPosition={contextMenuPosition}
              onExpandedChange={setExpandedNodeIds}
              isCompactOverride={isCompactOverride}
              isExplorer={isExplorer}
              readOnly={readOnly}
              disableSelection={disableSelection}
            />
            <TreeNodeContent
              node={node}
              template={template}
              isExpanded={isExpanded}
              level={level}
              onSelect={onSelect as any}
              contextualParentId={node.id}
              overrideExpandedIds={overrideExpandedIds}
              onExpandedChange={setExpandedNodeIds as any}
              isCompactOverride={isCompactOverride}
              isExplorer={isExplorer}
              readOnly={readOnly}
              disableSelection={disableSelection}
            />
          </Collapsible>
        </CardContent>
      </Card>
      {!readOnly && (
        <TreeNodeModals
          node={node}
          template={template}
        />
      )}
      {isExplorer && node.children && node.children.length > 0 && isExpanded && (
        <div className="pl-3 ml-[7px] border-l border-border/50">
          {node.children.map((childNode) => (
            <div key={`${childNode.id}_${node.id}`}>
              <TreeNodeComponent
                node={childNode}
                level={level + 1}
                siblings={node.children}
                onSelect={onSelect}
                contextualParentId={node.id}
                overrideExpandedIds={overrideExpandedIds}
                onExpandedChange={onExpandedChange}
                isCompactOverride={isCompactOverride}
                isExplorer={isExplorer}
                readOnly={readOnly}
                disableSelection={disableSelection}
              />
              {!readOnly && !disableSelection && <TreeNodeDropZone id={`gap_${childNode.id}_${node.id}`} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
