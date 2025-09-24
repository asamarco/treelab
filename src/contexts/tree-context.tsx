

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
  Field,
  StorageInfo,
  PurgeResult,
} from "@/lib/types";
import { generateNodeName, deepCloneNode, generateClientSideId, generateJsonForExport } from "@/lib/utils";
import {
  saveTreeFile,
  loadTreeFile,
  loadTreeNodes,
  createNode as createNodeInDb,
  updateNode as updateNodeInDb,
  deleteNodeWithChildren,
  reorderSiblings,
  batchCreateNodes,
  batchUpdateNodes,
  addParentToNode,
} from "@/lib/data-service";
import { createNodesArchive } from "@/lib/archive";
import { HtmlExportView } from "@/components/tree/html-export-view";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "./auth-context";
import { useImmer, useImmerReducer } from "use-immer";
import { useDebouncedCallback } from 'use-debounce';
import type { WritableDraft } from 'immer';
import { useTreeRoots } from "./tree-roots";
import path from 'path';
import { create } from "domain";
import { fetchFileAsBuffer } from "@/lib/data-service";


/* ----------------------------- Helper functions ---------------------------- */

const createDefaultTreeFile = (
  title: string,
  userId: string,
  order: number
): { treeFile: Omit<TreeFile, "tree" | "id">; initialNodes: Omit<TreeNode, "id" | "children" | "_id">[] } => {
  const defaultTemplates: Template[] = [];
  const initialNodes: Omit<TreeNode, "id" | "children" | "_id">[] = [];
  const now = new Date().toISOString();
  return {
    treeFile: { title, userId, templates: defaultTemplates, expandedNodeIds: [], order, createdAt: now, updatedAt: now },
    initialNodes,
  };
};

function traverseTree(
  nodes: TreeNode[],
  cb: (node: TreeNode, parent: TreeNode | null) => void,
  parent: TreeNode | null = null
) {
  for (const node of nodes) {
    cb(node, parent);
    if (node.children && node.children.length > 0) traverseTree(node.children, cb, node);
  }
}

function mapTree(nodes: TreeNode[], mapper: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => {
    const mapped = mapper(n);
    return {
      ...mapped,
      children: mapped.children && mapped.children.length > 0 ? mapTree(mapped.children, mapper) : mapped.children || [],
    };
  });
}

function getContextualOrder(node: TreeNode, siblings: readonly TreeNode[], contextualParentId: string | null): number {
  const pIndex = contextualParentId ? (node.parentIds || []).indexOf(contextualParentId) : (node.parentIds || []).indexOf('root');
  const fallbackOrder = siblings.findIndex(s => s.id === node.id);
  return (pIndex !== -1 && node.order && node.order.length > pIndex) ? node.order[pIndex] : (fallbackOrder !== -1 ? fallbackOrder : 0);
}

/**
 * @important
 * This function's implementation is carefully crafted to work correctly with
 * the Immer library's draft state. It avoids methods that can cause "read-only"
 * errors (like array.push or array.splice) by directly mutating the `order`
 * property of the draft node.
 *
 * DO NOT MODIFY THIS FUNCTION without a deep understanding of Immer's mechanics
 * and a specific reason to do so, as it can easily re-introduce subtle bugs
 * related to state immutability.
 */
function resequenceSiblingsForAdd(
    siblings: WritableDraft<TreeNode>[],
    contextualParentId: string | null
): void {
    const parentIdToFind = contextualParentId || 'root';
    siblings.forEach((node, newIndex) => {
        let parentSlot = (node.parentIds || []).indexOf(parentIdToFind);

        // If the node was just moved to this parent, the parentId might not be there yet.
        if (parentSlot === -1) {
            if (!node.parentIds) node.parentIds = [];
            if (!node.parentIds.includes(parentIdToFind)) {
                node.parentIds.push(parentIdToFind);
            }
            parentSlot = node.parentIds.length - 1;
        }
        
        // Ensure order array is long enough. This is key for adding clones.
        if (!node.order) node.order = [];
        while (node.order.length < node.parentIds.length) {
            node.order.push(0); 
        }

        const currentOrder = node.order[parentSlot];
        if (currentOrder !== newIndex) {
            node.order[parentSlot] = newIndex;
        }
    });
}


async function createNodeSubtreeInDb(
  nodeData: TreeNode,
  ownerUserId: string,
  treeId: string,
  parentId: string | null,
  order: number[]
): Promise<TreeNode> {
  const { id, children, ...rest } = nodeData;
  const created = await createNodeInDb({
    ...rest,
    data: rest.data || {},
    userId: ownerUserId,
    treeId,
    parentIds: parentId ? [parentId] : ['root'],
    order,
  } as Omit<TreeNode, "id" | "children" | "_id">);
  const newChildren: TreeNode[] = [];
  if (children && children.length > 0) {
    for (const [index, child] of children.entries()) {
      newChildren.push(await createNodeSubtreeInDb(child, ownerUserId, treeId, created.id, [index]));
    }
  }
  return { ...created, children: newChildren };
}

/* -------------------------------- Interfaces ------------------------------- */

export interface ClipboardState {
  nodes: TreeNode[] | null;
  operation: "cut" | "copy" | null;
}

interface TreeContextType {
  // Tree management
  allTrees: TreeFile[];
  setAllTrees: (updater: (draft: WritableDraft<TreeFile[]>) => void) => void;
  activeTreeId: string | null;
  activeTree: TreeFile | undefined;
  setActiveTreeId: (id: string | null) => void;
  createNewTree: (title: string) => Promise<string | null>;
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
  setTemplates: (updater: (draft: WritableDraft<Template[]>) => void) => void;
  importTemplates: (newTemplates: Template[]) => void;
  tree: TreeNode[];
  setTree: (updater: (currentTree: TreeNode[]) => TreeNode[] | void) => void;

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
  moveNodes: (moves: { nodeId: string; targetNodeId: string; position: 'child' | 'sibling' | 'child-bottom'; sourceContextualParentId: string | null; targetContextualParentId: string | null; isCutOperation?: boolean }[]) => Promise<void>;

  // Tree meta/UI
  treeTitle: string;
  setTreeTitle: (treeId: string, title: string) => void;
  expandedNodeIds: string[];
  setExpandedNodeIds: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>) => void;
  expandAllFromNode: (nodeId: string, parentId: string | null) => void;
  collapseAllFromNode: (nodeId: string, parentId: string | null) => void;
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

  const [clipboard, setClipboard] = useState<ClipboardState>({ nodes: null, operation: null });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState<string | null>(null);

  const { toast } = useToast();
  
  const {
    allTrees,
    setAllTrees,
    activeTree,
    activeTreeId,
    isTreeDataLoading,
    historyStack,
    redoStack,
    canUndo,
    canRedo,
    setActiveTreeId,
    undoLastAction,
    redoLastAction,
    performAction,
    updateActiveTree,
    createNewTree,
    deleteTree,
    updateTreeOrder,
    shareTree,
    revokeShare,
    setTreePublicStatus,
    listExamples,
    loadExample,
    importTreeArchive,
    importTreeFromJson,
    reloadAllTrees,
    reloadActiveTree,
    setTreeTitle,
    uploadAttachment,
    linkTreeToRepo,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    commitToRepo,
    fetchRepoHistory,
    syncFromRepo,
    restoreToCommit,
    conflictState,
    resolveConflict,
    analyzeStorage,
    purgeStorage,
  } = useTreeRoots({initialTree});

  /* --------------------------------- Exports -------------------------------- */

  const getTemplateById = useCallback(
    (id: string): Template | undefined => {
      return activeTree?.templates?.find((t) => t.id === id);
    },
    [activeTree]
  );
  
  const getSiblingOrderRange = useCallback((siblings: TreeNode[], parentId: string | null): { minOrder: number; maxOrder: number } => {
      if (siblings.length === 0) return { minOrder: 0, maxOrder: 0 };
      
      const orders = siblings.map(s => getContextualOrder(s, siblings, parentId));
      
      return {
          minOrder: Math.min(...orders),
          maxOrder: Math.max(...orders),
      };
  }, []);

  const exportNodesAsJson = (nodesToExport: TreeNode[], baseName: string) => {
    if (!activeTree || nodesToExport.length === 0) return;
    const dataToExport = generateJsonForExport(baseName, nodesToExport, activeTree.templates);
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
    if (!activeTree) return;
    await createNodesArchive(nodes, activeTree.tree, activeTree.templates, baseName, (relativePath: string) =>
      fetchFileAsBuffer(activeTree.userId, relativePath)
    );
  };

  const blobToDataURI = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target && typeof e.target.result === "string") resolve(e.target.result);
        else reject(new Error("Failed to read blob as Data URI"));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const exportNodesAsHtml = async (elementId: string, nodes: TreeNode[], title: string) => {
    if (!activeTree) return;

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

  /* ------------------------------- Tree state ------------------------------- */
  const setTree = (updater: (draft: WritableDraft<TreeNode[]>) => void | TreeNode[]) => {
    updateActiveTree((current) => {
      const result = typeof updater === 'function' ? updater(current.tree) : updater;
      if (result !== undefined) {
        current.tree = result as WritableDraft<TreeNode[]>;
      }
    });
  };
  
  const setTemplates = (updater: (draft: WritableDraft<Template[]>) => void | Template[]) => {
    updateActiveTree((current) => {
      const result = typeof updater === 'function' ? updater(current.templates) : updater;
      if (result !== undefined) {
        current.templates = result as WritableDraft<Template[]>;
      }
    });
  };

  const importTemplates = (newTemplates: Template[]) => {
    updateActiveTree((draft) => {
      const existingIds = new Set(draft.templates.map((t) => t.id));
      let importedCount = 0;
      newTemplates.forEach((t) => {
        if (!existingIds.has(t.id)) {
          draft.templates.push(t);
          existingIds.add(t.id);
          importedCount++;
        }
      });
      console.log(`INFO: Imported ${importedCount} new templates.`);
    });
  };

  const setExpandedNodeIds = (updater: (draft: string[]) => string[] | void) => {
    updateActiveTree(
      (draft) => {
        const currentExpanded = draft.expandedNodeIds;
        const result = typeof updater === 'function' ? updater(currentExpanded) : updater;
        if (result !== undefined) { 
            draft.expandedNodeIds = result;
        }
      }
    );
  };
  
  const findNodeAndParent = useCallback(
    (nodeId: string, nodes: TreeNode[] = activeTree?.tree ?? []): { node: TreeNode; parent: TreeNode | null } | null => {
        const search = (searchNodes: TreeNode[], parent: TreeNode | null): { node: TreeNode; parent: TreeNode | null } | null => {
            for (const node of searchNodes) {
                if (node.id === nodeId) {
                    return { node, parent };
                }
                if (node.children) {
                    const found = search(node.children, node);
                    if (found) return found;
                }
            }
            return null;
        };
        
        return search(nodes, null);
    },
    [activeTree]
  );

  const findNodeAndContextualParent = useCallback(
    (nodeId: string | null, contextualParentId: string | null, nodes: TreeNode[] = activeTree?.tree ?? []): { node: TreeNode, parent: TreeNode | null } | null => {
        if (!nodeId) return null; // Can't find a null node
        
        // Helper to perform the actual search
        const search = (nodesToSearch: TreeNode[], currentParent: TreeNode | null): { node: TreeNode, parent: TreeNode | null } | null => {
            for (const node of nodesToSearch) {
                // If we found the node, we return it with its immediate structural parent
                if (node.id === nodeId) {
                    return { node, parent: currentParent };
                }
                if (node.children) {
                    const found = search(node.children, node);
                    if (found) return found;
                }
            }
            return null;
        };

        // If a contextual parent ID is provided, it means we are looking for a specific instance
        // of the node that is a child of this specific parent.
        if (contextualParentId && contextualParentId !== 'root') {
            const contextualParentInfo = findNodeAndParent(contextualParentId, nodes);
            if (contextualParentInfo?.node?.children) {
                 const nodeInContext = contextualParentInfo.node.children.find(c => c.id === nodeId);
                 if (nodeInContext) {
                    // We found the correct instance.
                    return { node: nodeInContext, parent: contextualParentInfo.node };
                 }
            }
        } 
        
        // Fallback: If no contextualParentId is given, or if the node wasn't found
        // in that specific context (which can happen for top-level drops), we just
        // find the first occurrence of the node in the entire tree.
        return findNodeAndParent(nodeId, nodes);
    },
    [activeTree, findNodeAndParent]
  );
  

  const getNodeInstancePaths = useCallback(
    (nodeId: string): string[] => {
      if (!activeTree) return [];
      const paths: string[] = [];
      const findPaths = (nodes: TreeNode[], currentPath: string[]) => {
        for (const node of nodes) {
          const newPath = [...currentPath, node.name];
          if (node.id === nodeId) paths.push(newPath.join(" > "));
          if (node.children) findPaths(node.children, newPath);
        }
      };
      findPaths(activeTree.tree, []);
      return paths;
    },
    [activeTree]
  );

  const expandAllFromNode = (nodeId: string, parentId: string | null) => {
    if (!activeTree) return;
    const result = findNodeAndParent(nodeId, activeTree.tree);
    if (!result) return;
    const { node } = result;
    const ids: string[] = [];
    traverseTree([node], (n, p) => {
      ids.push(`${n.id}_${(p?.id ?? parentId) || "root"}`);
    });
    setExpandedNodeIds((draft: string[]) => {
        const idSet = new Set(draft);
        ids.forEach(id => idSet.add(id));
        return Array.from(idSet);
    });
  };

  const collapseAllFromNode = (nodeId: string, parentId: string | null) => {
    if (!activeTree) return;
    const result = findNodeAndParent(nodeId, activeTree.tree);
    if (!result) return;
    const { node } = result;
    const ids = new Set<string>();
    traverseTree([node], (n, p) => {
      ids.add(`${n.id}_${(p?.id ?? parentId) || "root"}`);
    });
    setExpandedNodeIds((draft: string[]) => draft.filter((id) => !ids.has(id)));
  };

  /* ------------------------------ Node operations --------------------------- */

const createNode = (
  nodeData: Partial<Omit<TreeNode, "id" | "children">>,
  treeId: string,
  ownerId: string
): TreeNode => {
  const id = generateClientSideId();
  return {
    id,
    name: nodeData.name ?? "Untitled Node",
    templateId: nodeData.templateId!,
    data: nodeData.data ?? {},
    children: [],
    userId: ownerId,
    treeId,
    parentIds: nodeData.parentIds ?? ['root'],
    order: nodeData.order ?? [0],
  };
};

const addNodes = async (
  targetNodeId: string | null,
  nodeDataToAdd: Partial<Omit<TreeNode, "id" | "children">>,
  position: "child" | "sibling" | "root",
  contextualParentId: string | null
) => {
  if (
    !activeTree ||
    !currentUser ||
    (activeTree.userId !== currentUser.id &&
      !activeTree.sharedWith?.includes(currentUser.id))
  ) {
    toast({
      variant: "destructive",
      title: "Permission Denied",
      description: "You do not have permission to add nodes to this tree.",
    });
    return;
  }

  const originalTrees = JSON.parse(JSON.stringify(allTrees));
  const isOwner = activeTree.userId === currentUser.id;
  let dbUpdates: { id: string; updates: Partial<TreeNode> }[] = [];

  const targetInfo = findNodeAndContextualParent(targetNodeId, contextualParentId);
  const parentNode = position === "child" ? targetInfo?.node : targetInfo?.parent;
  const siblings = parentNode ? parentNode.children : activeTree?.tree;

  if (!siblings) {
    console.error("Failed to find a valid sibling list for the new node.");
    return;
  }

  const insertIndex =
    position === "child"
      ? siblings.length
      : targetInfo
        ? siblings.findIndex((n) => n.id === targetNodeId) + 1
        : siblings.length;

  const newNode = createNode(
    {
      ...nodeDataToAdd,
      parentIds: parentNode ? [parentNode.id] : ["root"],
      order: [insertIndex],
    },
    activeTree.id,
    activeTree.userId
  );

  const { children, ...newNodeForDb } = newNode;
  if (!newNodeForDb) {
    console.error("Failed to prepare node for DB operation.");
    return;
  }

  performAction((draft) => {
    const treeDraft = draft.find((t) => t.id === activeTreeId);
    if (!treeDraft) return;

    const parentInfo = parentNode
      ? findNodeAndContextualParent(parentNode.id, contextualParentId, treeDraft.tree)
      : null;

    const draftSiblings = parentInfo ? parentInfo.node.children : treeDraft.tree;
    if (!draftSiblings) return;

    draftSiblings.splice(insertIndex, 0, newNode);

    const parentId = parentNode?.id || "root";

    const updatedSiblings = draftSiblings.map((node, newIndex) => {
      const parentIds = node.parentIds ? [...node.parentIds] : [];
      let parentSlot = parentIds.indexOf(parentId);
      if (parentSlot === -1) {
        parentIds.push(parentId);
        parentSlot = parentIds.length - 1;
      }

      const order = node.order ? [...node.order] : [];
      while (order.length < parentIds.length) {
        order.push(0);
      }
      order[parentSlot] = newIndex;

      return {
        ...node,
        parentIds,
        order,
      };
    });

    // Replace siblings with updated versions
    for (let i = 0; i < updatedSiblings.length; i++) {
      draftSiblings[i] = updatedSiblings[i];
    }

    dbUpdates = updatedSiblings.map((node) => ({
      id: node.id,
      updates: { order: node.order },
    }));

    if (parentNode) {
      const instanceId = `${parentNode.id}_${contextualParentId || "root"}`;
      if (!treeDraft.expandedNodeIds.includes(instanceId)) {
        treeDraft.expandedNodeIds.push(instanceId);
      }
    }
  });

  try {
    await createNodeInDb({ ...newNodeForDb, _id: newNodeForDb.id });
    if (dbUpdates.length > 0) {
      await batchUpdateNodes(dbUpdates);
    }
    toast({
      title: "Node Added",
      description: `Node "${newNodeForDb.name}" created successfully.`,
    });
  } catch (error) {
    console.error("Failed to save new node to DB", error);
    toast({
      variant: "destructive",
      title: "Save failed",
      description: "Could not save new node.",
    });
    setAllTrees(() => originalTrees);
  }
};


  const addRootNode = async (nodeData: Partial<Omit<TreeNode, "id" | "children">>) => {
    await addNodes(null, nodeData, "root", null);
  };
  
  const addChildNode = async (
    parentNodeId: string,
    childNodeData: Partial<Omit<TreeNode, "id" | "children">>,
    contextualParentId: string | null
  ) => {
    await addNodes(parentNodeId, childNodeData, "child", contextualParentId);
  };
  
  const addSiblingNode = async (
    siblingNodeId: string,
    nodeToAddData: Partial<Omit<TreeNode, "id" | "children">>,
    contextualParentId: string | null
  ) => {
    await addNodes(siblingNodeId, nodeToAddData, "sibling", contextualParentId);
  };

  const updateNode = async (nodeId: string, newNodeData: Partial<Omit<TreeNode, "id" | "children">>) => {
    if (!activeTree) return;
    
    updateActiveTree((draft) => {
        traverseTree(draft.tree, (node) => {
            if (node.id === nodeId) {
                Object.assign(node, newNodeData);
            }
        });
    });

    await updateNodeInDb(nodeId, { ...newNodeData });
  };

  const computeTemplateDataMigration = (node: TreeNode, from: Template, to: Template) => {
    const newData: Record<string, any> = {};
    const oldFieldMap = new Map(from.fields.map((f) => [f.name, f]));
    for (const newField of to.fields) {
      const oldField = oldFieldMap.get(newField.name);
      if (oldField && (node.data || {})[oldField.id] !== undefined) newData[newField.id] = (node.data || {})[oldField.id];
    }
    return newData;
  };

  const changeNodesTemplate = async (nodeIds: string[], newTemplateId: string) => {
    if (!activeTree || !currentUser || activeTree.userId !== currentUser.id) {
      toast({
        variant: "destructive",
        title: "Permission Denied",
        description: "Only the tree owner can change templates.",
      });
      return;
    }
  
    const targetTemplate = getTemplateById(newTemplateId);
    if (!targetTemplate) return;
  
    const nodeIdSet = new Set(nodeIds);
    let dbUpdates: { id: string; updates: Partial<TreeNode> }[] = [];
  
    performAction((draft) => {
      const treeToUpdate = draft.find((t) => t.id === activeTreeId);
      if (treeToUpdate) {
        const updates: { id: string; updates: Partial<TreeNode> }[] = [];
  
        traverseTree(treeToUpdate.tree, (node) => {
          if (nodeIdSet.has(node.id)) {
            const from = getTemplateById(node.templateId);
            if (from && from.id !== targetTemplate.id) {
              const data = computeTemplateDataMigration(node, from, targetTemplate);
              const name = generateNodeName(targetTemplate, data);
              const update = { templateId: newTemplateId, data, name };
              Object.assign(node, update);
              updates.push({ id: node.id, updates: update });
            }
          }
        });
  
        // assign to outer variable after mutation
        dbUpdates = updates;
      }
    });
  
    // defer DB update so it runs after Immer applies changes
    setTimeout(async () => {
      console.log("[changeNodesTemplate] updates to persist", { count: dbUpdates.length, dbUpdates });
      if (dbUpdates.length > 0) {
        await batchUpdateNodes(dbUpdates);
        console.log("[changeNodesTemplate] persisted successfully");
      }
      setSelectedNodeIds([]);
    }, 0);
  };
  

  const changeNodeTemplate = async (nodeId: string, newTemplateId: string) => {
    await changeNodesTemplate([nodeId], newTemplateId);
  };

  const changeMultipleNodesTemplate = async (instanceIds: string[], newTemplateId: string) => {
    const uniqueNodeIds = Array.from(new Set(instanceIds.map((id) => id.split("_")[0])));
    await changeNodesTemplate(uniqueNodeIds, newTemplateId);
  };

  const deleteNodes = async (instanceIds: string[]) => {
    if (!currentUser) return;
    
    performAction(draft => {
      const treeToUpdate = draft.find(t => t.id === activeTreeId);
      if (!treeToUpdate) return;
      
      instanceIds.forEach(instanceId => {
          const [nodeId, parentIdStr] = instanceId.split('_');
          const parentId = parentIdStr === 'root' ? null : parentIdStr;
          
          const nodeInfo = findNodeAndContextualParent(nodeId, parentId, treeToUpdate.tree);
          if (!nodeInfo) return;

          const { node, parent } = nodeInfo;
          const siblings = parent ? parent.children : treeToUpdate.tree;
          const nodeIndex = siblings.findIndex(n => n.id === nodeId);

          if (nodeIndex > -1) {
              // If it's the last instance, we are deleting the node and its children.
              if (node.parentIds.length <= 1) {
                  siblings.splice(nodeIndex, 1);
              } else {
                  // It's a clone instance, so just unlink it from this parent
                  const parentIndex = node.parentIds.indexOf(parentId || 'root');
                  if (parentIndex > -1) {
                      node.parentIds.splice(parentIndex, 1);
                      node.order.splice(parentIndex, 1);
                  }
                  // Remove it from the current visual context (children array)
                  siblings.splice(nodeIndex, 1);
              }
              resequenceSiblingsForAdd(siblings, parentId);
          }
      });
    });
    
    setTimeout(async () => {
      const dbDeleteOperations = instanceIds.map(instanceId => {
        const [nodeId, parentIdStr] = instanceId.split('_');
        return { id: nodeId, parentId: parentIdStr === 'root' ? null : parentIdStr };
      });
      if (dbDeleteOperations.length > 0) {
        console.log(`INFO: Deleting ${dbDeleteOperations.length} node(s) in DB.`);
        await Promise.all(dbDeleteOperations.map(({ id, parentId }) => deleteNodeWithChildren(id, parentId)));
      }
    }, 0);
    setSelectedNodeIds([]);
  };
  
  const deleteNode = async (nodeId: string, contextualParentId: string | null) => {
    const instanceId = `${nodeId}_${contextualParentId || 'root'}`;
    await deleteNodes([instanceId]);
  };

  const pasteNodes = async (
    targetNodeId: string,
    position: 'child' | 'sibling',
    contextualParentId: string | null,
    nodesToPasteParam?: TreeNode[]
  ) => {
    const nodesToPasteSource = nodesToPasteParam || clipboard.nodes;
    if (!nodesToPasteSource || !activeTree) return;
  
    const originalTrees = JSON.parse(JSON.stringify(allTrees)); // rollback snapshot
    const nodesToPaste = nodesToPasteSource.map(node => deepCloneNode(node));
    const allPastedNodesForDb: Omit<TreeNode, 'children' | '_id'>[] = [];
  
    const updatePastedNode = (node: TreeNode, newParentId: string | null, orderIndex: number): TreeNode => {
        const updatedNode = {
          ...node,
          parentIds: newParentId ? [newParentId] : ['root'],
          order: [orderIndex],
          treeId: activeTree.id,
          userId: activeTree.userId
        };

        const { children, ...dbNode } = updatedNode;
        allPastedNodesForDb.push(dbNode);

        if(children) {
            updatedNode.children = children.map((child, index) => updatePastedNode(child, updatedNode.id, index));
        }

        return updatedNode;
    };
  
    const pastedNodes = nodesToPaste.map((node, index) => {
      const nodeInfo = findNodeAndContextualParent(targetNodeId, contextualParentId);
      const parent = position === 'child' ? nodeInfo?.node : nodeInfo?.parent;
      const siblings = parent ? parent.children : activeTree.tree;
      const targetIndex = position === 'child' 
        ? siblings.length 
        : (siblings.findIndex(n => n.id === targetNodeId) + 1); 
      return updatePastedNode(node, parent?.id || 'root', targetIndex + index);
    });

    performAction(draft => {
      const activeTreeDraft = draft.find(t => t.id === activeTreeId);
      if (!activeTreeDraft) return;

      const parentInfo = findNodeAndContextualParent(targetNodeId, contextualParentId, activeTreeDraft.tree);
      const parentNode = position === 'child' ? parentInfo?.node : parentInfo?.parent;
      const siblings = parentNode ? parentNode.children : activeTreeDraft.tree;
      const targetIndex = position === 'child' 
        ? siblings.length 
        : (siblings.findIndex(n => n.id === targetNodeId) + 1); 

      if(targetIndex === 0 && position === 'sibling') {
        console.error("Paste target sibling not found");
        return;
      }
      
      siblings.splice(targetIndex, 0, ...pastedNodes);
      resequenceSiblingsForAdd(siblings, parentNode?.id || null);

      if (parentNode) {
        // Use the correct contextual parent ID for the instance ID.
        const parentContextId = (findNodeAndParent(parentNode.id)?.parent?.id) || 'root';
        const parentInstanceId = `${parentNode.id}_${parentContextId}`;
        if (!activeTreeDraft.expandedNodeIds.includes(parentInstanceId)) {
          activeTreeDraft.expandedNodeIds.push(parentInstanceId);
        }
      }
    });
  
    if (allPastedNodesForDb.length > 0) {
      try {
        await batchCreateNodes(allPastedNodesForDb);
        console.info(`INFO: batchCreateNodes completed successfully with ${allPastedNodesForDb.length} nodes`);
      } catch (error) {
        console.error("ERROR: Failed to paste nodes to DB", error);
        toast({ variant: 'destructive', title: "Paste failed", description: "Could not save pasted nodes." });
        setAllTrees(originalTrees);
      }
    }
  
    if (!nodesToPasteParam) { // Only clear clipboard if it wasn't a programmatic paste (like drag-copy)
        setClipboard({ nodes: null, operation: null });
    }
  };

    const moveNodes = async (moves: {
        nodeId: string;
        targetNodeId: string;
        position: 'child' | 'sibling' | 'child-bottom';
        sourceContextualParentId: string | null;
        targetContextualParentId: string | null;
        isCutOperation?: boolean;
    }[]) => {
        const isUndoable = !moves.some(m => m.isCutOperation);
        let finalDbUpdates: { id: string; updates: Partial<TreeNode> }[] = [];
        
        performAction((draft) => {
            const activeTreeDraft = draft.find((t) => t.id === activeTreeId);
            if (!activeTreeDraft) return;

            const dbUpdatesForThisAction: { id: string; updates: Partial<TreeNode> }[] = [];

            for (const move of moves) {
                const sourceNodeInfo = findNodeAndContextualParent(move.nodeId, move.sourceContextualParentId, activeTreeDraft.tree);
                if (!sourceNodeInfo) {
                    console.warn(`Could not find source node instance ${move.nodeId}_${move.sourceContextualParentId}`);
                    continue;
                }
                const sourceNodeParent = sourceNodeInfo.parent;
                const sourceSiblings = sourceNodeParent ? sourceNodeParent.children : activeTreeDraft.tree;
                
                const movingNodeIndex = sourceSiblings.findIndex((n) => n.id === move.nodeId);
                if (movingNodeIndex === -1) {
                    console.warn(`Could not find moving node ${move.nodeId} in source context.`);
                    continue;
                }

                const [movingNode] = sourceSiblings.splice(movingNodeIndex, 1);

                const targetNodeInfo = findNodeAndContextualParent(move.targetNodeId, move.targetContextualParentId, activeTreeDraft.tree);
                const newParentNode = move.position === 'child' || move.position === 'child-bottom'
                    ? targetNodeInfo?.node
                    : targetNodeInfo?.parent;

                const newSiblings = newParentNode ? newParentNode.children : activeTreeDraft.tree;
                const newParentId = newParentNode ? newParentNode.id : null;
                
                // --- Start of Clone Handling Logic ---
                const oldParentId = move.sourceContextualParentId || 'root';
                const oldParentIndex = movingNode.parentIds.indexOf(oldParentId);
                
                if (oldParentIndex > -1) {
                    movingNode.parentIds.splice(oldParentIndex, 1);
                    movingNode.order.splice(oldParentIndex, 1);
                }

                const newParentIdToAdd = newParentId || 'root';
                if (!movingNode.parentIds.includes(newParentIdToAdd)) {
                    movingNode.parentIds.push(newParentIdToAdd);
                }
                // --- End of Clone Handling Logic ---

                let targetNodeIndexInNewSiblings = newSiblings.findIndex(n => n.id === move.targetNodeId);

                if (move.position === 'sibling' && move.isCutOperation) {
                  targetNodeIndexInNewSiblings++;
                }
                
                const insertIndex = move.position === 'sibling' 
                    ? targetNodeIndexInNewSiblings 
                    : newSiblings.length;
                
                newSiblings.splice(insertIndex, 0, movingNode);

                resequenceSiblingsForAdd(sourceSiblings, move.sourceContextualParentId);
                if (sourceSiblings !== newSiblings) {
                    resequenceSiblingsForAdd(newSiblings, newParentId);
                }

                const changedNodesForDb = [
                    ...sourceSiblings.map((n) => ({ id: n.id, updates: { order: n.order } })),
                    ...newSiblings.map((n) => ({
                        id: n.id,
                        updates: { order: n.order, parentIds: n.parentIds },
                    })),
                ];

                changedNodesForDb.forEach((upd) => {
                    const existing = dbUpdatesForThisAction.find((u) => u.id === upd.id);
                    if (existing) {
                        Object.assign(existing.updates, upd.updates);
                    } else {
                        dbUpdatesForThisAction.push(upd);
                    }
                });
            }
            finalDbUpdates = JSON.parse(JSON.stringify(dbUpdatesForThisAction));
        }, isUndoable);

        setTimeout(async () => {
            if (finalDbUpdates.length > 0) {
                console.log(`INFO: Batch updating ${finalDbUpdates.length} nodes in DB.`);
                await batchUpdateNodes(finalDbUpdates);
            }
        }, 0);
    };

    const moveNodeOrder = async (nodeId: string, direction: "up" | "down", contextualParentId: string | null) => {
      const parentInfo = findNodeAndContextualParent(contextualParentId, null, activeTree?.tree);
      const siblings = parentInfo ? parentInfo.node.children : activeTree?.tree;
      if (!siblings || siblings.length < 2) return;
  
      const sortedSiblings = [...siblings].sort((a, b) =>
          getContextualOrder(a, siblings, contextualParentId) - getContextualOrder(b, siblings, contextualParentId)
      );
  
      const currentIndex = sortedSiblings.findIndex(n => n.id === nodeId);
      if (currentIndex === -1) return;
  
      if (direction === 'up' && currentIndex > 0) {
          const nodeToMove = sortedSiblings[currentIndex];
          const targetNode = sortedSiblings[currentIndex - 1];
          moveNodes([{
              nodeId: nodeToMove.id,
              targetNodeId: targetNode.id,
              position: 'sibling',
              sourceContextualParentId: contextualParentId,
              targetContextualParentId: contextualParentId,
          }]);
      } else if (direction === 'down' && currentIndex < sortedSiblings.length - 1) {
          const nodeToMove = sortedSiblings[currentIndex + 1];
          const targetNode = sortedSiblings[currentIndex];
          moveNodes([{
              nodeId: nodeToMove.id,
              targetNodeId: targetNode.id,
              position: 'sibling',
              sourceContextualParentId: contextualParentId,
              targetContextualParentId: contextualParentId,
          }]);
      }
    };
  

const pasteNodesAsClones = async (targetNodeId: string, as: 'child' | 'sibling', nodeIdsToClone: string[], contextualParentId: string | null) => {
    if (nodeIdsToClone.length === 0 || !activeTree) return;

    const targetNodeInfo = findNodeAndContextualParent(targetNodeId, contextualParentId);
    if (!targetNodeInfo) {
        toast({ variant: "destructive", title: "Operation Aborted", description: `Target node ${targetNodeId} not found.` });
        return;
    }
    const { node: targetNode, parent: targetParent } = targetNodeInfo;

    const newParent = as === 'child' ? targetNode : targetParent;
    const newParentId = newParent?.id || 'root';
    
    const siblings = newParent?.children || activeTree.tree;
    const targetNodeIndex = as === 'sibling' ? siblings.findIndex(n => n.id === targetNodeId) : -1;
    const baseOrder = as === 'sibling' 
        ? (targetNodeIndex !== -1 ? getContextualOrder(targetNode, siblings, newParentId) + 1 : siblings.length) 
        : siblings.length;
    
    await Promise.all(nodeIdsToClone.map((nodeId, i) => {
      if (newParentId === nodeId) {
          toast({ variant: "destructive", title: "Invalid Operation", description: `Cannot clone node as a child of itself.` });
          return Promise.resolve();
      }
      const nodeToClone = findNodeAndParent(nodeId)?.node;
      if (!nodeToClone) return Promise.resolve();
      if ((nodeToClone.parentIds || []).includes(newParentId || 'root')) {
          toast({ title: "Already Exists", description: `Node "${nodeToClone.name}" is already a clone under "${newParent?.name || 'root'}".` });
          return Promise.resolve();
      }
      return addParentToNode(nodeId, newParentId, baseOrder + i);
    }));

    let dbUpdates: { id: string, updates: Partial<TreeNode> }[] = [];

    performAction(draft => {
        const activeTreeDraft = draft.find(t => t.id === activeTreeId);
        if (!activeTreeDraft) return;
        
        const parentInfo = newParentId === 'root'
            ? null
            : findNodeAndContextualParent(newParentId, findNodeAndParent(newParentId, activeTreeDraft.tree)?.parent?.id || null, activeTreeDraft.tree);
            
        if (!parentInfo && newParentId !== 'root') return;

        const draftSiblings = parentInfo ? parentInfo.node.children : activeTreeDraft.tree;
        const draftTargetIndex = draftSiblings.findIndex(n => n.id === targetNodeId);
        const insertIndex = as === 'sibling' ? (draftTargetIndex !== -1 ? draftTargetIndex + 1 : draftSiblings.length) : draftSiblings.length;

        nodeIdsToClone.forEach((nodeId, i) => {
            const originalNodeInDraft = findNodeAndParent(nodeId, activeTreeDraft.tree)?.node;
            if (originalNodeInDraft) {
                const parentIdToAdd = newParentId || 'root';
                if (!originalNodeInDraft.parentIds.includes(parentIdToAdd)) {
                    originalNodeInDraft.parentIds.push(parentIdToAdd);
                    originalNodeInDraft.order.push(baseOrder + i);
                }
                if (!draftSiblings.some(c => c.id === originalNodeInDraft.id)) {
                    draftSiblings.splice(insertIndex + i, 0, originalNodeInDraft);
                }
            }
        });
        
        resequenceSiblingsForAdd(draftSiblings, newParentId);
        
        // After re-sequencing, collect the order updates for all siblings in the current context
        dbUpdates = draftSiblings.map(n => ({
            id: n.id,
            updates: {
                parentIds: n.parentIds, // Ensure parentIds are also sent for clones
                order: n.order
            }
        }));
    });
    
    if (dbUpdates.length > 0) {
        setTimeout(async () => {
            await batchUpdateNodes(dbUpdates);
            console.log(`INFO: Persisted order for ${dbUpdates.length} siblings after clone paste.`);
        }, 0);
    }
};

  const updateNodeNamesForTemplate = async (template: Template) => {
    if (!activeTree) return;
  
    // Use the current, non-draft state to calculate the updates
    const toUpdate: { id: string; updates: Partial<TreeNode> }[] = [];
    traverseTree(activeTree.tree, (n) => {
      if (n.templateId !== template.id) return;
      const newName = generateNodeName(template, n.data);
      if (newName !== n.name) {
        toUpdate.push({ id: n.id, updates: { name: newName } });
      }
    });
  
    // If there are updates, then apply them to the state and the database
    if (toUpdate.length > 0) {
      // First, update the state optimistically
      performAction((draft) => {
        const treeToUpdate = draft.find((t) => t.id === activeTreeId);
        if (treeToUpdate) {
          const updatesMap = new Map(toUpdate.map((u) => [u.id, u.updates.name]));
          traverseTree(treeToUpdate.tree, (n) => {
            if (updatesMap.has(n.id)) {
              n.name = updatesMap.get(n.id)!;
            }
          });
        }
      }, false); // isUndoable is false for this atomic operation
  
      // Then, persist the changes to the database
      await batchUpdateNodes(toUpdate);
      console.log(`INFO: Updated ${toUpdate.length} node names in the database.`);
    }
  };

  const toggleStarredForSelectedNodes = async () => {
    if (!activeTree || selectedNodeIds.length === 0) return;

    const firstSelectedInstanceId = selectedNodeIds[0];
    const firstNodeId = firstSelectedInstanceId.split('_')[0];
    const firstNode = findNodeAndParent(firstNodeId)?.node;
    if (!firstNode) return;

    // Determine the new starred state based on the first selected node
    const newIsStarred = !firstNode.isStarred;

    const updates = selectedNodeIds.map(instanceId => {
        const nodeId = instanceId.split('_')[0];
        return { id: nodeId, updates: { isStarred: newIsStarred } };
    });
    
    // De-duplicate updates by node ID
    const uniqueUpdates = Array.from(new Map(updates.map(u => [u.id, u])).values());

    performAction(draft => {
        const activeTreeDraft = draft.find(t => t.id === activeTreeId);
        if (!activeTreeDraft) return;

        const selectedNodeIdsSet = new Set(uniqueUpdates.map(u => u.id));
        traverseTree(activeTreeDraft.tree, (node) => {
            if (selectedNodeIdsSet.has(node.id)) {
                node.isStarred = newIsStarred;
            }
        });
    });

    await batchUpdateNodes(uniqueUpdates);
    toast({
        title: newIsStarred ? "Added to Favorites" : "Removed from Favorites",
        description: `${uniqueUpdates.length} node(s) updated.`
    });
  };
  

  /* --------------------------------- Context value --------------------------- */

  const value: TreeContextType = {
    allTrees,
    setAllTrees: (updater: any) => setAllTrees(updater),
    activeTree,
    activeTreeId,
    setActiveTreeId,
    createNewTree,
    deleteTree,
    updateTreeOrder,
    shareTree,
    revokeShare,
    setTreePublicStatus,
    listExamples,
    loadExample,
    importTreeArchive,
    importTreeFromJson,
    reloadAllTrees,
    reloadActiveTree,
    isTreeDataLoading,
    templates: activeTree?.templates ?? [],
    setTemplates,
    importTemplates,
    tree: activeTree?.tree ?? [],
    setTree,
    addRootNode,
    addChildNode,
    addSiblingNode,
    updateNode,
    updateNodeNamesForTemplate,
    changeNodeTemplate,
    changeMultipleNodesTemplate,
    deleteNode,
    deleteNodes,
    pasteNodes,
    moveNodes,
    treeTitle: activeTree?.title ?? "",
    setTreeTitle,
    expandedNodeIds: activeTree?.expandedNodeIds ?? [],
    setExpandedNodeIds,
    expandAllFromNode,
    collapseAllFromNode,
    selectedNodeIds,
    setSelectedNodeIds,
    lastSelectedNodeId,
    setLastSelectedNodeId,
    getTemplateById,
    clipboard,
    setClipboard,
    findNodeAndParent,
    findNodeAndContextualParent,
    getNodeInstancePaths,
    uploadAttachment,
    moveNodeOrder,
    pasteNodesAsClones,
    undoLastAction,
    canUndo,
    redoLastAction,
    canRedo,
    getSiblingOrderRange,
    exportNodesAsJson,
    exportNodesAsArchive,
    exportNodesAsHtml,
    conflictState,
    resolveConflict,
    linkTreeToRepo,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    commitToRepo,
    fetchRepoHistory,
    syncFromRepo,
    restoreToCommit,
    analyzeStorage,
    purgeStorage,
    toggleStarredForSelectedNodes,
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

    
