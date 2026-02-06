/**
 * @fileoverview
 * This file defines the `TreeView` component, which is the main container for
 * rendering the entire tree structure.
 *
 * It uses the `DndContext` from `@dnd-kit` to enable drag-and-drop functionality
 * for all nodes within the tree. It maps over the root nodes and renders a
 * `TreeNodeComponent` for each one, which then recursively renders its children.
 * It also contains the logic for handling node updates, deletions, additions,
 * and moves, propagating these changes to the global state via `useTreeContext`.
 */
"use client";

import { useMemo, useState, useEffect, SetStateAction, useCallback } from "react";
import { TreeNode } from "@/lib/types";
import { TreeNodeComponent } from "./tree-node";
import { useTreeContext } from "@/contexts/tree-context";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  closestCenter,
} from "@dnd-kit/core";
import { useToast } from "@/hooks/use-toast";
import { TreeNodeDropZone } from "./tree-node-dropzone";
import { WritableDraft } from "immer";
import { useUIContext } from "@/contexts/ui-context";
import { getContextualOrder } from "@/lib/utils";
import { useAuthContext } from "@/contexts/auth-context";

interface TreeViewProps {
  nodes: TreeNode[];
  overrideExpandedIds?: string[];
  onExpandedChange?: (updater: SetStateAction<string[]>) => void;
  isCompactOverride?: boolean;
  readOnly?: boolean;
  disableSelection?: boolean;
}

export function TreeView({ nodes, overrideExpandedIds, onExpandedChange, isCompactOverride, readOnly = false, disableSelection = false }: TreeViewProps) {
  const { currentUser } = useAuthContext();
  const { 
      tree, 
      moveNodes, 
      selectedNodeIds,
      setSelectedNodeIds,
      lastSelectedNodeId,
      setLastSelectedNodeId,
      expandedNodeIds: globalExpandedNodeIds,
      setExpandedNodeIds: setGlobalExpandedNodeIds,
      pasteNodesAsClones,
      findNodeAndParent,
      pasteNodes,
      expandAllFromNode,
      collapseAllFromNode,
      moveNodeOrder,
      undoLastAction,
      redoLastAction,
      clipboard,
  } = useTreeContext();
  const { dialogState, setDialogState, setIsTwoPanelMode, isTwoPanelMode } = useUIContext();

  const isUsingLocalExpansion = !!overrideExpandedIds && !!onExpandedChange;

  const setExpandedNodeIds = (onExpandedChange || setGlobalExpandedNodeIds) as unknown as (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
  const expandedNodeIds = overrideExpandedIds || globalExpandedNodeIds;
  
  const { toast } = useToast();

  const handleDragEnd = (event: DragEndEvent) => {
    if (readOnly || disableSelection) return;
    const { active, over, activatorEvent } = event;
    
    if (!active || !over) return;
    
    const findNodeAndParentInTree = (nodeId: string, searchNodes: TreeNode[]): { node: TreeNode, parent: TreeNode | null } | null => {
        for(const node of searchNodes) {
            if (node.id === nodeId) return { node, parent: null };
            if (node.children) {
                const found = findNodeAndParentInTree(nodeId, node.children);
                if (found) return { ...found, parent: found.parent || node };
            }
        }
        return null;
    };
    
    if (!currentUser) {
        // Allow local-only drag-drop for public users, without modifiers
        const { nodeId: activeId } = active.data.current ?? {};
        const overIdWithContext = over.id as string;
        const isDroppingOnGap = overIdWithContext.startsWith('gap_');
        const overNodeId = overIdWithContext.replace(/^(gap_|node_)/, '').split('_')[0];

        const activeNodeFromContext = findNodeAndParentInTree(activeId, tree)?.node;
        if (activeNodeFromContext && findNodeAndParentInTree(overNodeId, [activeNodeFromContext])) {
          toast({
            variant: "destructive",
            title: "Invalid Move",
            description: "You cannot move a node into one of its own descendants.",
          });
          return;
        }

        const [targetNodeId, overParentIdStr] = overIdWithContext.replace(/^(gap_|node_)/, '').split('_');
        const targetContextualParentId = overParentIdStr === 'root' ? null : overParentIdStr;
        
        moveNodes([{ 
            nodeId: activeId, 
            targetNodeId: targetNodeId, 
            position: isDroppingOnGap ? 'sibling' : 'child-bottom', 
            sourceContextualParentId: active.data.current?.parentId,
            targetContextualParentId: targetContextualParentId,
        }]);
        return;
    }

    const typedActivatorEvent = activatorEvent as (KeyboardEvent);
    const isCtrlPressed = typedActivatorEvent.ctrlKey || typedActivatorEvent.metaKey;
    const isShiftPressed = typedActivatorEvent.shiftKey;

    const isCloneOperation = isCtrlPressed && isShiftPressed;
    const isCopyOperation = isCtrlPressed && !isShiftPressed;
    
    const { nodeId: activeId, parentId: sourceContextualParentId } = active.data.current ?? {};
    const overIdWithContext = over.id as string;
    
    const isDroppingOnGap = overIdWithContext.startsWith('gap_');
    const isDroppingOnNode = overIdWithContext.startsWith('node_');
    
    const overNodeInstanceId = overIdWithContext.replace(/^(gap_|node_)/, '');
    const [overNodeId, overParentIdStr] = overNodeInstanceId.split('_');
    const targetContextualParentId = overParentIdStr === 'root' ? null : overParentIdStr;

    const activeIdWithContext = active.id as string;
    const activeNodeId = activeIdWithContext.split('_')[0];

    if (activeNodeId === overNodeId && !isDroppingOnGap) return;

    const activeNodeInfo = findNodeAndParent(activeId, tree);
    if (!activeNodeInfo) return;

    if (isCloneOperation) {
        pasteNodesAsClones(overNodeId, isDroppingOnGap ? 'sibling' : 'child', [activeNodeId], targetContextualParentId);
        return;
    }

    if (isCopyOperation) {
        const fullNodeToCopy = findNodeAndParent(activeNodeId)?.node;
        if (fullNodeToCopy) {
            pasteNodes(overNodeId, isDroppingOnGap ? 'sibling' : 'child', null, [fullNodeToCopy]);
        }
        return;
    }

    const activeNodeFromContext = findNodeAndParentInTree(activeId, tree)?.node;
    if (activeNodeFromContext && findNodeAndParentInTree(overNodeId, [activeNodeFromContext])) {
      toast({
        variant: "destructive",
        title: "Invalid Move",
        description: "You cannot move a node into one of its own descendants.",
      });
      return;
    }
    
    moveNodes([{ 
        nodeId: activeId, 
        targetNodeId: overNodeId, 
        position: isDroppingOnGap ? 'sibling' : 'child-bottom', 
        sourceContextualParentId: sourceContextualParentId,
        targetContextualParentId: targetContextualParentId,
    }]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );
  
  const flattenedInstances = useMemo(() => {
    const result: { instanceId: string; node: TreeNode }[] = [];
    const expandedIdSet = new Set(expandedNodeIds);

    const traverse = (nodesToTraverse: TreeNode[], parentId: string | null) => {
        for (const node of nodesToTraverse) {
            const instanceId = `${node.id}_${parentId || 'root'}`;
            result.push({ instanceId, node });

            if (expandedIdSet.has(instanceId) && node.children) {
                traverse(node.children, node.id);
            }
        }
    };
    traverse(nodes, null);
    return result;
  }, [nodes, expandedNodeIds]);

  const handleSelect = (instanceId: string, isShiftClick: boolean, isCtrlClick: boolean) => {
    if (readOnly || disableSelection) return;
    if (isShiftClick && lastSelectedNodeId) {
      const lastIndex = flattenedInstances.findIndex(i => i.instanceId === lastSelectedNodeId);
      const currentIndex = flattenedInstances.findIndex(i => i.instanceId === instanceId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeInstanceIds = flattenedInstances.slice(start, end + 1).map(i => i.instanceId);
        setSelectedNodeIds(rangeInstanceIds);
      }
    } else if (isCtrlClick) {
      setSelectedNodeIds(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(instanceId)) {
          newSelection.delete(instanceId);
        } else {
          newSelection.add(instanceId);
        }
        setLastSelectedNodeId(instanceId);
        return Array.from(newSelection);
      });
    } else {
        const isAlreadySelected = selectedNodeIds.includes(instanceId);
        if (isAlreadySelected && selectedNodeIds.length === 1) {
            setSelectedNodeIds([]); // Deselect if it's the only one selected
        } else {
            setSelectedNodeIds([instanceId]); // Select only this one
        }
        setLastSelectedNodeId(instanceId);
    }
  };
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (readOnly || disableSelection) return;
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
      return;
    }

    // Check if any modal is open before processing shortcuts
    const isAnyModalOpen = Object.values(dialogState).some(state => state === true);
    if (isAnyModalOpen) {
      return;
    }
    
    // Shortcuts that work for both public and authenticated users
    if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z' && currentUser) {
            event.preventDefault();
            undoLastAction();
            return;
        }
        if ((event.key === 'y' || (event.key === 'Z' && event.shiftKey)) && currentUser) {
            event.preventDefault();
            redoLastAction();
            return;
        }
    }
    
    if (event.key === 'Escape') {
      if (selectedNodeIds.length > 0) {
        event.preventDefault();
        setSelectedNodeIds([]);
      }
      return;
    }

    // Toggle Two Panel mode
    if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        setIsTwoPanelMode(prev => !prev);
        return;
    }
    
    // Shortcuts only for authenticated users
    if (currentUser) {
       if (event.ctrlKey || event.metaKey) {
          if (event.key === 'v') { // Paste
              event.preventDefault();
              if (selectedNodeIds.length !== 1 || !clipboard.nodes) return;
              const targetInstanceId = selectedNodeIds[0];
              const [targetNodeId, contextualParentIdStr] = targetInstanceId.split('_');
              const contextualParentId = contextualParentIdStr === 'root' ? null : contextualParentIdStr;
              
              if (event.altKey) {
                if (clipboard.operation === 'cut') return;
                pasteNodesAsClones(targetNodeId, 'child', clipboard.nodes.map(n => n.id), contextualParentId);
              } else {
                  if (clipboard.operation === 'cut') {
                    const moves = clipboard.nodes.map(sourceNode => ({
                        nodeId: sourceNode.id,
                        targetNodeId: targetNodeId,
                        position: 'child' as 'child' | 'sibling',
                        sourceContextualParentId: sourceNode.parentIds[0] ?? null,
                        targetContextualParentId: contextualParentId,
                        isCutOperation: true,
                    }));
                    moveNodes(moves);
                  } else {
                    pasteNodes(targetNodeId, 'child', contextualParentId);
                  }
              }
          }
       } else if (selectedNodeIds.length === 1) {
          const instanceId = selectedNodeIds[0];
          const [nodeId, parentIdStr] = instanceId.split('_');
          const contextualParentId = parentIdStr === 'root' ? null : parentIdStr;
          if (event.key === 'e') {
              event.preventDefault();
              setDialogState({ isNodeEditOpen: true, nodeInstanceIdForAction: instanceId });
              return;
          }
          if (event.key === 'Enter') {
              event.preventDefault();
              setDialogState({ isAddChildOpen: true, nodeInstanceIdForAction: instanceId });
              return;
          }
          if (event.key === '+') {
              event.preventDefault();
              setDialogState({ isAddSiblingOpen: true, nodeInstanceIdForAction: instanceId });
              return;
          }
          if (event.key === 'i') {
              event.preventDefault();
              moveNodeOrder(nodeId, 'up', contextualParentId);
              return;
          }
          if (event.key === 'k') {
              event.preventDefault();
              moveNodeOrder(nodeId, 'down', contextualParentId);
              return;
          }
       }
    }


    let nextInstanceId: string | null = null;
    
    if (selectedNodeIds.length === 0) {
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && flattenedInstances.length > 0) {
        event.preventDefault();
        nextInstanceId = flattenedInstances[0].instanceId;
        setSelectedNodeIds([nextInstanceId]);
        setLastSelectedNodeId(nextInstanceId);
      }
    } else if (selectedNodeIds.length > 0) {
        const isCtrlPressed = event.ctrlKey || event.metaKey;
        const currentInstanceId = lastSelectedNodeId || selectedNodeIds[selectedNodeIds.length - 1];
        const [currentNodeId, currentParentIdStr] = currentInstanceId.split('_');
        const currentContextualParentId = currentParentIdStr === 'root' ? null : currentParentIdStr;

        switch (event.key) {
            case 'ArrowUp':
            case 'ArrowDown':
                event.preventDefault();
                if (isCtrlPressed && currentUser) { // Sibling navigation
                    if (selectedNodeIds.length !== 1) break;
                    
                    const parentInfo = currentContextualParentId ? findNodeAndParent(currentContextualParentId, tree) : null;
                    const siblings = parentInfo ? parentInfo.node.children : tree;

                    if (!siblings || siblings.length < 2) break;
                    
                    const sortedSiblings = [...siblings].sort((a,b) => getContextualOrder(a, siblings, currentContextualParentId) - getContextualOrder(b, siblings, currentContextualParentId));
                    const currentIndex = sortedSiblings.findIndex(s => s.id === currentNodeId);
                    
                    const nextIndex = event.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
                    if (nextIndex >= 0 && nextIndex < sortedSiblings.length) {
                        nextInstanceId = `${sortedSiblings[nextIndex].id}_${currentContextualParentId || 'root'}`;
                        setSelectedNodeIds([nextInstanceId]);
                        setLastSelectedNodeId(nextInstanceId);
                    }

                } else { // Standard/Shift navigation
                    const currentIndex = flattenedInstances.findIndex(i => i.instanceId === currentInstanceId);
                    if (currentIndex === -1) break;

                    const nextIndex = event.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
                    if (nextIndex >= 0 && nextIndex < flattenedInstances.length) {
                        nextInstanceId = flattenedInstances[nextIndex].instanceId;
                        if (event.shiftKey) {
                            setSelectedNodeIds(prev => {
                                const newSelection = new Set(prev);
                                if (newSelection.has(nextInstanceId!)) {
                                    newSelection.delete(currentInstanceId);
                                } else {
                                    newSelection.add(nextInstanceId!);
                                }
                                return Array.from(newSelection);
                            });
                        } else {
                            setSelectedNodeIds([nextInstanceId]);
                        }
                        setLastSelectedNodeId(nextInstanceId);
                    }
                }
                break;
            case 'ArrowRight':
                event.preventDefault();
                if (isCtrlPressed) {
                    selectedNodeIds.forEach(instanceId => {
                        const [nodeId, parentId] = instanceId.split('_');
                        expandAllFromNode([{ nodeId, parentId: parentId === 'root' ? null : parentId }]);
                    });
                } else if (selectedNodeIds.length === 1) {
                    setExpandedNodeIds((draft) => {
                        if (!draft.includes(currentInstanceId)) {
                            draft.push(currentInstanceId);
                        }
                    }, false);
                }
                break;
            case 'ArrowLeft':
                event.preventDefault();
                if (isCtrlPressed) {
                    selectedNodeIds.forEach(instanceId => {
                        const [nodeId, parentId] = instanceId.split('_');
                        collapseAllFromNode([{ nodeId, parentId: parentId === 'root' ? null : parentId }]);
                    });
                } else if (selectedNodeIds.length === 1) {
                    setExpandedNodeIds((draft) => {
                        const index = draft.indexOf(currentInstanceId);
                        if (index > -1) {
                            draft.splice(index, 1);
                        }
                    }, false);
                }
                break;
        }
    }


    if (nextInstanceId) {
      // Use requestAnimationFrame to ensure the DOM has updated with the new selection
      requestAnimationFrame(() => {
        const element = document.getElementById(`node-card-${nextInstanceId}`);
        element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [selectedNodeIds, lastSelectedNodeId, flattenedInstances, setSelectedNodeIds, setLastSelectedNodeId, setExpandedNodeIds, expandAllFromNode, collapseAllFromNode, setDialogState, moveNodeOrder, findNodeAndParent, tree, undoLastAction, redoLastAction, dialogState, currentUser, clipboard, pasteNodes, pasteNodesAsClones, setIsTwoPanelMode, readOnly, disableSelection]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);


  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      collisionDetection={closestCenter}
    >
      <div id="tree-view-container">
        {nodes.map((node, index) => (
          <div key={`${node.id}-root-wrapper`}>
            <TreeNodeComponent
              node={node}
              level={0}
              siblings={nodes}
              onSelect={handleSelect}
              contextualParentId={null}
              overrideExpandedIds={expandedNodeIds}
              onExpandedChange={setExpandedNodeIds}
              isCompactOverride={isCompactOverride}
              readOnly={readOnly}
              disableSelection={disableSelection}
            />
            {!readOnly && !disableSelection && <TreeNodeDropZone id={`gap_${node.id}_root`} />}
          </div>
        ))}
        {/* Add a final drop zone at the end of the root list */}
        {!readOnly && !disableSelection && <TreeNodeDropZone id={`gap_end_root`} className="h-4"/>}
      </div>
    </DndContext>
  );
}
