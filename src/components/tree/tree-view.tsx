

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

import { useMemo, useState, useEffect, SetStateAction } from "react";
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
import type { WritableDraft } from "immer";

interface TreeViewProps {
  nodes: TreeNode[];
  initialExpandedIds?: Set<string>;
}

export function TreeView({ nodes, initialExpandedIds }: TreeViewProps) {
  const { 
      tree, 
      moveNodes, 
      setSelectedNodeIds,
      lastSelectedNodeId,
      setLastSelectedNodeId,
      expandedNodeIds: globalExpandedNodeIds,
      setExpandedNodeIds: setGlobalExpandedNodeIds,
      pasteNodesAsClones,
      findNodeAndParent,
      pasteNodes,
  } = useTreeContext();
  
  const [localExpandedNodeIds, setLocalExpandedNodeIds] = useState<string[]>([]);
  
  const isLocal = initialExpandedIds !== undefined;
  
  const setExpandedNodeIds = (isLocal
    ? setLocalExpandedNodeIds
    : setGlobalExpandedNodeIds) as (updater: SetStateAction<string[]> | ((draft: WritableDraft<string[]>) => void | WritableDraft<string[]>)) => void;

  const expandedNodeIds = isLocal ? localExpandedNodeIds : globalExpandedNodeIds;

  
  useEffect(() => {
    if (initialExpandedIds) {
      setLocalExpandedNodeIds(Array.from(initialExpandedIds));
    }
  }, [initialExpandedIds]);

  const { toast } = useToast();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, activatorEvent } = event;

    if (!active || !over) return;
    
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
    
    if (sourceContextualParentId === overNodeId && !isDroppingOnGap) {
        moveNodes([{ nodeId: activeId, targetNodeId: overNodeId, position: 'child-bottom', sourceContextualParentId: sourceContextualParentId, targetContextualParentId: sourceContextualParentId }]);
        return;
    }

    const findNodeAndParentInTree = (nodeId: string, searchNodes: TreeNode[]): { node: TreeNode, parent: TreeNode | null } | null => {
        for(const node of searchNodes) {
            if (node.id === nodeId) return { node, parent: null };
            if (node.children) {
                const found = findNodeAndParentInTree(nodeId, node.children);
                if (found) return { ...found, parent: found.parent || node };
            }
        }
        return null;
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
    
    moveNodes([{ nodeId: activeId, targetNodeId: overNodeId, position: isDroppingOnGap ? 'sibling' : 'child', sourceContextualParentId: sourceContextualParentId, targetContextualParentId: targetContextualParentId }]);
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
    const result: { instanceId: string, node: TreeNode }[] = [];
    const visited = new Set<string>(); // Keep track of visited node IDs to prevent cycles in data

    const traverse = (nodesToTraverse: TreeNode[], parentId: string | null) => {
        for (const node of nodesToTraverse) {
            const instanceId = `${node.id}_${parentId || 'root'}`;
            result.push({ instanceId, node });

            if (node.children) {
                traverse(node.children, node.id);
            }
        }
    };
    traverse(nodes, null);
    return result;
  }, [nodes]);

  const handleSelect = (instanceId: string, isChecked: boolean, isShiftClick: boolean) => {
    if (isShiftClick && lastSelectedNodeId) {
      const lastIndex = flattenedInstances.findIndex(i => i.instanceId === lastSelectedNodeId);
      const currentIndex = flattenedInstances.findIndex(i => i.instanceId === instanceId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeInstanceIds = flattenedInstances.slice(start, end + 1).map(i => i.instanceId);
        
        setSelectedNodeIds(prev => {
          const newSelection = new Set(prev);
          rangeInstanceIds.forEach(id => {
            if (isChecked) newSelection.add(id);
            else newSelection.delete(id);
          });
          return Array.from(newSelection);
        });
      }
    } else {
      setSelectedNodeIds(prev => {
        const newSelection = new Set(prev);
        if (isChecked) {
          newSelection.add(instanceId);
        } else {
          newSelection.delete(instanceId);
        }
        return Array.from(newSelection);
      });
    }
    setLastSelectedNodeId(instanceId);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      collisionDetection={closestCenter}
    >
      <div id="tree-view-container">
        {nodes.map((node, index) => (
          <div key={`${node.id}-root-wrapper`}>
            <TreeNodeDropZone id={`gap_${node.id}_root`} />
            <TreeNodeComponent
              node={node}
              level={0}
              siblings={nodes}
              onSelect={handleSelect}
              contextualParentId={null}
              overrideExpandedIds={expandedNodeIds}
              onExpandedChange={setExpandedNodeIds}
            />
          </div>
        ))}
         <TreeNodeDropZone id={`gap_end_root`} />
      </div>
    </DndContext>
  );
}
