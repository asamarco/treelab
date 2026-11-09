"use client";

import { useContext, useMemo } from 'react';
import { TreeContext } from '@/contexts/tree-context';
import { AuthContext } from '@/contexts/auth-context';
import { TreeNode } from '@/lib/types';
import { getAncestorChain, resolveNodeDisplayName } from '@/lib/template-text';

export function useNodeDisplayName(node: TreeNode, ancestors?: TreeNode[]): string {
  const treeContext = useContext(TreeContext);
  const authContext = useContext(AuthContext);
  const dateFormat = authContext?.currentUser?.dateFormat;
  const allTemplates = treeContext?.templates;
  const findNodeAndParent = treeContext?.findNodeAndParent;
  const template = treeContext?.getTemplateById(node.templateId);

  return useMemo(() => {
    if (!allTemplates) return node.name;
    return resolveNodeDisplayName(
      node,
      template,
      allTemplates,
      ancestors ?? (() => (findNodeAndParent ? getAncestorChain(node.id, findNodeAndParent) : [])),
      dateFormat,
    );
  }, [node, ancestors, template, allTemplates, findNodeAndParent, dateFormat]);
}

export function useNodeDisplayNames(nodes: TreeNode[]): Map<string, string> {
  const treeContext = useContext(TreeContext);
  const authContext = useContext(AuthContext);
  const dateFormat = authContext?.currentUser?.dateFormat;
  const allTemplates = treeContext?.templates;
  const findNodeAndParent = treeContext?.findNodeAndParent;
  const getTemplateById = treeContext?.getTemplateById;

  return useMemo(() => {
    const names = new Map<string, string>();
    for (const node of nodes) {
      names.set(
        node.id,
        allTemplates && getTemplateById
          ? resolveNodeDisplayName(
              node,
              getTemplateById(node.templateId),
              allTemplates,
              () => (findNodeAndParent ? getAncestorChain(node.id, findNodeAndParent) : []),
              dateFormat,
            )
          : node.name,
      );
    }
    return names;
  }, [nodes, allTemplates, getTemplateById, findNodeAndParent, dateFormat]);
}
