

/**
 * @fileoverview
 * Optimized Tree Context for managing tree data and actions.
 * Key improvements:
 * - Unified single/multi-node operations (delete, template changes).
 * - Extracted reusable tree traversal and ordering helpers.
 * - Batched DB writes where possible.
 * - Simplified optimistic updates with targeted mutations.
 */
"use client";

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";
import ReactDOMServer from "react-dom/server";
import {
  TreeFile,
  Template,
  TreeNode,
  User,
  ExampleInfo,
  AttachmentInfo,
  GitCommit,
  StorageInfo,
  PurgeResult,
  Command,
  AddNodesCommand,
  DeleteNodesCommand,
  MoveNodesCommand,
  UpdateNodesCommand,
  UpdateTreeFileCommand,
  ExpandCollapseCommand,
  ClipboardState,
  ReorderNodesCommand,
} from '@/lib/types';
import { generateJsonForExport } from '@/lib/utils';
import { createNodesArchive } from "@/lib/archive";
import { HtmlExportView } from "@/components/tree/html-export-view";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "./auth-context";
import { useTreeRoots } from "./tree-roots";
import { fetchFileAsBuffer } from "@/lib/data-service";
import path from 'path';
import { WritableDraft } from "immer";

/* --------------------------------- Helper functions --------------------------------- */

const traverseTree = (
  nodes: TreeNode[],
  cb: (node: TreeNode, parent: TreeNode | null) => void,
  parent: TreeNode | null = null
) => {
  for (const node of nodes) {
    cb(node, parent);
    if (node.children && node.children.length > 0) {
      traverseTree(node.children, cb, node);
    }
  }
};


/* -------------------------------- Interfaces ------------------------------- */

interface TreeContextType {
  // Tree management
  allTrees: TreeFile[];
  activeTreeId: string | null;
  activeTree: TreeFile | undefined;
  setActiveTreeId: (id: string | null) => void;
  createNewTree: (title: string, user?: User) => Promise<string | null>;
  deleteTree: (id: string) => Promise<void>;
  updateTreeOrder: (updates: { id: string; order: number }[]) => Promise<void>;
  shareTree: (treeId: string, userId: string) => Promise<void>;
  revokeShare: (treeId: string, userId: string) => Promise<void>;
  setTreePublicStatus: (treeId: string, isPublic: boolean) => Promise<void>;
  listExamples: () => Promise<ExampleInfo[]>;
  loadExample: (fileName: string) => Promise<string | null>;
  importTreeArchive: (file: File) => Promise<void>;
  importTreeFromJson: (jsonData: any, user?: User, rewriteAttachmentPaths?: boolean) => Promise<string | null>;
  isTreeDataLoading: boolean;
  reloadAllTrees: () => Promise<void>;
  reloadActiveTree: (treeIdToLoad?: string) => Promise<void>;

  // Export Functions
  exportNodesAsJson: (nodes: TreeNode[], baseName: string) => void;
  exportNodesAsArchive: (nodes: TreeNode[], baseName: string) => Promise<void>;
  exportNodesAsHtml: (elementId: string, nodes: TreeNode[], title: string) => void;

  // Active tree properties
  templates: Template[];
  setTemplates: (templatesOrUpdater: Template[] | ((current: Template[]) => Template[])) => void;
  importTemplates: (newTemplates: Template[]) => void;
  tree: TreeNode[];

  // Node CRUD and transforms
  addRootNode: (nodeData: Partial<Omit<TreeNode, "id" | "children">>) => Promise<void>;
  addChildNode: (
    parentNodeId: string,
    childNodeData: Partial<Omit<TreeNode, "id" | "children">>,
    contextualParentId: string | null
  ) => Promise<void>;
  addSiblingNode: (
    siblingNodeId: string,
    nodeToAddData: Partial<Omit<TreeNode, "id" | "children">>,
    contextualParentId: string | null
  ) => Promise<void>;
  updateNode: (nodeId: string, newNodeData: Partial<Omit<TreeNode, "id" | "children">>) => Promise<void>;
  updateNodeNamesForTemplate: (template: Template) => Promise<void>;
  changeNodeTemplate: (nodeId: string, newTemplateId: string) => Promise<void>;
  changeMultipleNodesTemplate: (instanceIds: string[], newTemplateId: string) => Promise<void>;
  deleteNode: (nodeId: string, contextualParentId: string | null) => Promise<void>;
  deleteNodes: (instanceIds: string[]) => Promise<void>;
  pasteNodes: (
    targetNodeId: string,
    position: 'child' | 'sibling',
    contextualParentId: string | null,
    nodes?: TreeNode[]
  ) => Promise<void>;
  moveNodes: (moves: { nodeId: string; targetNodeId: string; position: 'child' | 'sibling' | 'child-bottom'; sourceContextualParentId: string | null; targetContextualParentId: string | null; }[]) => Promise<void>;

  // Tree meta/UI
  treeTitle: string;
  setTreeTitle: (treeId: string, title: string) => void;
  expandedNodeIds: string[];
  setExpandedNodeIds: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
  expandAllFromNode: (nodes: { nodeId: string, parentId: string | null }[]) => void;
  collapseAllFromNode: (nodes: { nodeId: string, parentId: string | null }[]) => void;
  selectedNodeIds: string[];
  setSelectedNodeIds: (updater: React.SetStateAction<string[]>) => void;
  lastSelectedNodeId: string | null;
  setLastSelectedNodeId: (id: string | null) => void;
  toggleStarredForSelectedNodes: () => Promise<void>;


  // Utility
  getTemplateById: (id: string) => Template | undefined;
  clipboard: ClipboardState;
  setClipboard: (clipboardState: ClipboardState) => void;
  findNodeAndParent: (nodeId: string, nodes?: TreeNode[]) => { node: TreeNode; parent: TreeNode | null } | null;
  findNodeAndContextualParent: (nodeId: string | null, contextualParentId: string | null, nodes?: TreeNode[]) => { node: TreeNode, parent: TreeNode | null } | null;
  getNodeInstancePaths: (nodeId: string) => string[];
  uploadAttachment: (relativePath: string, dataUri: string, fileName: string, ownerId: string) => Promise<AttachmentInfo | null>;
  moveNodeOrder: (nodeId: string, direction: "up" | "down", contextualParentId: string | null) => Promise<void>;
  pasteNodesAsClones: (targetNodeId: string, as: 'child' | 'sibling', nodeIdsToClone: string[], contextualParentId: string | null) => Promise<void>;
  undoLastAction: () => void;
  canUndo: boolean;
  redoLastAction: () => void;
  canRedo: boolean;
  undoActionDescription: string | null;
  redoActionDescription: string | null;
  getSiblingOrderRange: (siblings: TreeNode[], parentId: string | null) => { minOrder: number; maxOrder: number };

  // Git Sync
  linkTreeToRepo: (treeId: string, repoOwner: string, repoName: string, branch: string, token: string) => Promise<void>;
  unlinkTreeFromRepo: (treeId: string) => void;
  createAndLinkTreeToRepo: (treeId: string, repoName: string, isPrivate: boolean, token: string) => Promise<void>;
  commitToRepo: (
    treeId: string,
    message: string,
    token: string,
    force?: boolean,
    treeFileToCommit?: TreeFile
  ) => Promise<{ success: boolean; error?: string; commitSha?: string }>;
  fetchRepoHistory: (treeFile: TreeFile, token: string) => Promise<GitCommit[]>;
  syncFromRepo: (treeFile: TreeFile, token: string) => Promise<{ success: boolean; message: string }>;
  restoreToCommit: (currentTreeId: string, commitSha: string, token: string) => Promise<void>;
  conflictState: { localTree: TreeFile; serverTree: TreeFile } | null;
  resolveConflict: (resolution: "local" | "server") => Promise<void>;

  // Storage Management
  analyzeStorage: (treeId?: string) => Promise<StorageInfo>;
  purgeStorage: (treeId?: string) => Promise<PurgeResult | null>;
}

export const TreeContext = createContext<TreeContextType | undefined>(undefined);

interface TreeProviderProps {
  children: ReactNode;
  initialTree?: TreeFile;
}


/* --------------------------------- Provider -------------------------------- */

export function TreeProvider({ children, initialTree }: TreeProviderProps) {
  const { currentUser } = useAuthContext();
  const { toast } = useToast();
  
  const treeRootsHook = useTreeRoots({initialTree});

  /* --------------------------------- Exports -------------------------------- */

  const getTemplateById = useCallback(
    (id: string): Template | undefined => {
      return treeRootsHook.activeTree?.templates?.find((t) => t.id === id);
    },
    [treeRootsHook.activeTree]
  );

  const exportNodesAsJson = (nodesToExport: TreeNode[], baseName: string) => {
    if (!treeRootsHook.activeTree || nodesToExport.length === 0) return;
    const dataToExport = generateJsonForExport(baseName, nodesToExport, treeRootsHook.activeTree.templates);
    const data = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName.replace(/\s/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportNodesAsArchive = async (nodes: TreeNode[], baseName: string) => {
    if (!treeRootsHook.activeTree) return;
    await createNodesArchive(nodes, treeRootsHook.activeTree.tree, treeRootsHook.activeTree.templates, baseName, (relativePath: string) =>
      fetchFileAsBuffer(treeRootsHook.activeTree!.userId, relativePath)
    );
  };

  const exportNodesAsHtml = async (elementId: string, nodes: TreeNode[], title: string) => {
    if (!treeRootsHook.activeTree) return;

    toast({ title: "Generating HTML...", description: "This may take a moment." });

    const cssResponse = await fetch("/globals.css");
    const cssText = await cssResponse.text();

    const imagePromises: Promise<{ path: string; dataUri: string }>[] = [];
    const attachmentsMap = new Map<string, string>();

    traverseTree(nodes, (node) => {
      const template = getTemplateById(node.templateId);
      if (!template) return;
      for (const field of template.fields) {
        const value = (node.data || {})[field.id];
        if (!value) continue;

        const processItem = (fileOrPath: string | AttachmentInfo) => {
          const serverPath = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
          if (typeof serverPath === 'string' && serverPath.startsWith('/attachments/')) {
            const originalFileName = typeof fileOrPath === "string" ? path.basename(serverPath) : fileOrPath.name;
            attachmentsMap.set(serverPath, originalFileName);
            const promise = fetch(serverPath)
              .then((res) => res.blob())
              .then(blobToDataURI)
              .then((dataUri) => ({ path: serverPath, dataUri }));
            imagePromises.push(promise);
          }
        };

        if (field.type === "picture" || field.type === "attachment") {
          (Array.isArray(value) ? value : [value]).forEach(processItem);
        }
      }
    });

    const imageResults = await Promise.all(imagePromises);
    const imageMap = new Map(imageResults.map((r) => [r.path, r.dataUri]));

    const staticHtml = ReactDOMServer.renderToStaticMarkup(
      <HtmlExportView
        nodes={nodes}
        title={title}
        getTemplateById={getTemplateById}
        imageMap={imageMap}
        attachmentsMap={attachmentsMap}
        currentUser={currentUser}
      />
    );

    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${title}</title>
          <style>${cssText}</style>
          <style>
            body { padding: 2rem; }
            .tree-node-card { border: 1px solid #e5e7eb; border-radius: 0.5rem; margin-bottom: 8px; }
            .tree-node-header { padding: 8px; display: flex; align-items: center; gap: 8px; }
            .tree-node-content { padding-left: 24px; padding-bottom: 8px; padding-right: 8px; }
            .attachment-link { display: block; margin-top: 4px; }
            img { max-width: 100%; height: auto; border-radius: 0.375rem; }
          </style>
        </head>
        <body class="font-body antialiased">
          ${staticHtml}
        </body>
      </html>
    `;

    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* --------------------------------- Tree state ------------------------------- */
  
  const setTemplates = (updater: Template[] | ((current: Template[]) => Template[])) => {
    treeRootsHook.setTemplates(updater);
  };
  

  const importTemplates = (newTemplates: Template[]) => {
    treeRootsHook.setTemplates((currentTemplates: Template[]) => {
      const existingIds = new Set(currentTemplates.map((t) => t.id));
      let importedCount = 0;
      const templatesToAdd = [];
      for (const t of newTemplates) {
        if (!existingIds.has(t.id)) {
          templatesToAdd.push(t);
          existingIds.add(t.id);
          importedCount++;
        }
      }
      console.log(`INFO: Imported ${importedCount} new templates.`);
      return [...currentTemplates, ...templatesToAdd];
    });
  };
  
  const expandAllFromNode = (nodesToExpand: { nodeId: string, parentId: string | null }[]) => {
    if (!treeRootsHook.activeTree || nodesToExpand.length === 0) return;
    
    const allIdsToAdd = new Set<string>();

    for (const { nodeId, parentId } of nodesToExpand) {
        const result = treeRootsHook.findNodeAndParent(nodeId, treeRootsHook.activeTree.tree);
        if (!result) continue;
        const { node } = result;

        traverseTree([node], (n, p) => {
            const currentParentContext = p?.id ?? parentId;
            allIdsToAdd.add(`${n.id}_${currentParentContext || "root"}`);
            // Also add paths for other parents if it's a clone
            (n.parentIds || []).forEach(pId => {
                if (pId !== (currentParentContext || 'root')) {
                    allIdsToAdd.add(`${n.id}_${pId}`);
                }
            });
        });
    }

    if (allIdsToAdd.size > 0) {
        treeRootsHook.setExpandedNodeIds((currentIds: WritableDraft<string[]>) => {
            const idSet = new Set(currentIds);
            allIdsToAdd.forEach(id => idSet.add(id));
            return Array.from(idSet);
        }, true);
    }
  };

  const collapseAllFromNode = (nodesToCollapse: { nodeId: string, parentId: string | null }[]) => {
    if (!treeRootsHook.activeTree || nodesToCollapse.length === 0) return;
    
    const allIdsToRemove = new Set<string>();

    for (const { nodeId, parentId } of nodesToCollapse) {
        const result = treeRootsHook.findNodeAndParent(nodeId, treeRootsHook.activeTree.tree);
        if (!result) continue;
        const { node } = result;

        traverseTree([node], (n, p) => {
            const currentParentContext = p?.id ?? parentId;
            allIdsToRemove.add(`${n.id}_${currentParentContext || "root"}`);
             // Also remove paths for other parents if it's a clone
            (n.parentIds || []).forEach(pId => {
                if (pId !== (currentParentContext || 'root')) {
                    allIdsToRemove.add(`${n.id}_${pId}`);
                }
            });
        });
    }
    
    if (allIdsToRemove.size > 0) {
      treeRootsHook.setExpandedNodeIds((currentIds: WritableDraft<string[]>) => {
        // Mutate draft directly for performance with Immer
        for (let i = currentIds.length - 1; i >= 0; i--) {
          if (allIdsToRemove.has(currentIds[i])) {
            currentIds.splice(i, 1);
          }
        }
      }, true);
    }
  };


  /* --------------------------------- Context value --------------------------- */

  const value: TreeContextType = {
    ...treeRootsHook,
    templates: treeRootsHook.activeTree?.templates ?? [],
    tree: treeRootsHook.activeTree?.tree ?? [],
    treeTitle: treeRootsHook.activeTree?.title ?? "",
    expandedNodeIds: treeRootsHook.activeTree?.expandedNodeIds ?? [],
    setTemplates,
    importTemplates,
    getTemplateById,
    exportNodesAsJson,
    exportNodesAsArchive,
    exportNodesAsHtml,
    expandAllFromNode,
    collapseAllFromNode,
    canRedo: treeRootsHook.canRedo,
  };

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>;
}

/* ---------------------------------- Hook ----------------------------------- */

export function useTreeContext() {
  const context = useContext(TreeContext);
  if (context === undefined) {
    throw new Error("useTreeContext must be used within a TreeProvider");
  }
  return context;
}

// Dummy blobToDataURI helper if not already available
const blobToDataURI = (blob: Blob): Promise<string> =>
new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    if (e.target && typeof e.target.result === 'string') resolve(e.target.result);
    else reject(new Error("Failed to read blob as Data URI"));
  };
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});
    
    
