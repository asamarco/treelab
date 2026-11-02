"use client";

import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { TreeNode } from "@/lib/types";
import { generateNodeName } from "@/lib/utils";

export function useBoardNodeActions(nodes: TreeNode[]) {
  const { getTemplateById, updateNode, findNodeAndParent, expandToNode } = useTreeContext();
  const { setDialogState, dialogState } = useUIContext();

  const moveNode = (nodeId: string, patch: Record<string, string>) => {
    const target = nodes.find(n => n.id === nodeId);
    const template = target ? getTemplateById(target.templateId) : undefined;
    if (!target || !template) return;
    const data = { ...(target.data || {}), ...patch };
    updateNode(target.id, { data, name: generateNodeName(template, data) });
  };

  const openNode = (nodeId: string) => {
    setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [nodeId] });
  };

  const editNode = (nodeId: string) => {
    const parentInfo = findNodeAndParent ? findNodeAndParent(nodeId) : null;
    const instanceId = `${nodeId}_${parentInfo?.parent?.id || "root"}`;
    expandToNode(nodeId);
    const currentIds = dialogState.openNodeEditInstanceIds || [];
    if (!currentIds.includes(instanceId)) {
      setDialogState({ openNodeEditInstanceIds: [...currentIds, instanceId] });
    }
  };

  return { moveNode, openNode, editNode };
}
