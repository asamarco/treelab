

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
  createTreeFile,
  deleteTreeFile as deleteTreeFileFromDb,
  listExamples as listExamplesFromDataService,
  loadExampleFromFile,
  fetchFileAsBuffer,
  createNode as createNodeInDb,
  updateNode as updateNodeInDb,
  deleteNodeWithChildren,
  reorderSiblings,
  loadAllTreeFiles,
  replaceTree,
  batchCreateNodes,
  batchUpdateNodes,
  addParentToNode,
  updateTreeOrder as updateTreeOrderInDb,
} from "@/lib/data-service";
import { getStorageInfo, purgeUnusedFiles } from "@/lib/storage-service";
import { readArchive, createNodesArchive } from "@/lib/archive";
import { HtmlExportView } from "@/components/tree/html-export-view";
import { useRouter } from "next/navigation";
import path from 'path';
import { useGitSync } from "@/hooks/useGitSync";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "./auth-context";
import { useImmer, useImmerReducer } from "use-immer";
import { saveAs } from 'file-saver';
import { useDebouncedCallback } from 'use-debounce';
import type { WritableDraft } from 'immer';

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
  const pIndex = contextualParentId ? (node.parentIds || []).indexOf(contextualParentId) : 0;
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
    siblings.forEach((node, newIndex) => {
        let parentSlot = -1;

        if (contextualParentId) {
            parentSlot = node.parentIds?.indexOf(contextualParentId) ?? -1;
            // If the node was just moved to this parent, the parentId might not be there yet.
            if (parentSlot === -1) {
                if (!node.parentIds) node.parentIds = [];
                node.parentIds.push(contextualParentId);
                parentSlot = node.parentIds.length - 1;
            }
        } else {
            // Root nodes
            parentSlot = (node.parentIds?.length ?? 0) === 0 ? 0 : -1;
        }

        if (parentSlot === -1) return;

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
    parentIds: parentId ? [parentId] : [],
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
  listExamples: () => Promise<ExampleInfo[]>;
  loadExample: (fileName: string) => Promise<string | null>;
  importTreeArchive: (file: File) => Promise<void>;
  importTreeFromJson: (jsonData: any, user?: User, rewriteAttachmentPaths?: boolean) => Promise<string | null>;
  isTreeDataLoading: boolean;
  reloadActiveTree: () => Promise<void>;

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
  setExpandedNodeIds: (updater: (draft: string[]) => void | string[]) => void;
  expandAllFromNode: (nodeId: string, parentId: string | null) => void;
  collapseAllFromNode: (nodeId: string, parentId: string | null) => void;
  selectedNodeIds: string[];
  setSelectedNodeIds: (updater: React.SetStateAction<string[]>) => void;
  lastSelectedNodeId: string | null;
  setLastSelectedNodeId: (id: string | null) => void;

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

/* --------------------------------- Provider -------------------------------- */

export function TreeProvider({ children }: { children: ReactNode }) {
  const { currentUser, setLastActiveTreeId: setLastActiveTreeIdForUser } = useAuthContext();
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isTreeDataLoading, setIsTreeDataLoading] = useState(true);
  const router = useRouter();
  const [allTrees, setAllTrees] = useImmer<TreeFile[]>([]);
  const [historyStack, setHistoryStack] = useImmer<TreeFile[][]>([]);
  const [redoStack, setRedoStack] = useImmer<TreeFile[][]>([]);
  const [activeTreeId, _setActiveTreeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const [clipboard, setClipboard] = useState<ClipboardState>({ nodes: null, operation: null });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState<string | null>(null);

  const { toast } = useToast();

  const performAction = useCallback(
    (updater: (draft: WritableDraft<TreeFile[]>) => void, isUndoable: boolean = true) => {
      if (isUndoable) {
        const currentState = JSON.parse(JSON.stringify(allTrees));
        setHistoryStack((draft) => {
          draft.push(currentState);
          if (draft.length > 20) draft.shift();
        });
        setRedoStack([]);
      }
      setAllTrees(updater);
      if (isUndoable) setIsDirty(true);
    },
    [allTrees, setAllTrees, setHistoryStack, setRedoStack]
  );

  const activeTree = allTrees.find((t) => t.id === activeTreeId);
  const canUndo = historyStack.length > 0;
  const canRedo = redoStack.length > 0;

  const undoLastAction = useCallback(() => {
    if (historyStack.length > 0) {
      const currentState = JSON.parse(JSON.stringify(allTrees));
      const lastState = historyStack[historyStack.length - 1];
      setRedoStack((draft) => {
        draft.push(currentState);
      });
      setAllTrees(() => lastState); // Directly set to the previous state
      setHistoryStack((draft) => {
        draft.pop();
      });
      setIsDirty(true);
      console.log("INFO: Undo action performed.");
    }
  }, [historyStack, allTrees, setAllTrees, setHistoryStack, setRedoStack]);
  
  const redoLastAction = useCallback(() => {
    if (redoStack.length > 0) {
      const currentState = JSON.parse(JSON.stringify(allTrees));
      const nextState = redoStack[redoStack.length - 1];
      setHistoryStack((draft) => {
        draft.push(currentState);
      });
      setAllTrees(() => nextState);
      setRedoStack((draft) => {
        draft.pop();
      });
      setIsDirty(true);
      console.log("INFO: Redo action performed.");
    }
  }, [redoStack, allTrees, setAllTrees, setHistoryStack, setRedoStack]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
         activeElement.tagName === 'TEXTAREA' ||
         activeElement.isContentEditable)
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") {
          e.preventDefault();
          undoLastAction();
        } else if (e.key === "y" || (e.key === "Z" && e.shiftKey)) {
          e.preventDefault();
          redoLastAction();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoLastAction, redoLastAction]);

  const updateActiveTree = (updater: (draft: TreeFile) => void, isUndoable: boolean = true) => {
    performAction((draft) => {
      const treeToUpdate = draft.find((t) => t.id === activeTreeId);
      if (treeToUpdate) {
        updater(treeToUpdate);
        treeToUpdate.updatedAt = new Date().toISOString();
      }
    }, isUndoable);
  };

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

  /* --------------------------------- Exports -------------------------------- */

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
    await createNodesArchive(nodes, activeTree.tree, activeTree.templates, baseName, (relativePath) =>
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

  /* --------------------------------- Import -------------------------------- */

  const importTreeFromJson = useCallback(
    async (jsonData: any, user?: User, rewriteAttachmentPaths: boolean = false): Promise<string | null> => {
      const userToImportFor = user || currentUser;
      if (!userToImportFor) {
        throw new Error("You must be logged in to import a tree.");
      }

      const nodes = jsonData.nodes || jsonData.tree;
      if (!nodes) {
        throw new Error("JSON file must contain a 'nodes' or 'tree' property.");
      }

      const idMap = new Map<string, string>();
      const templates = jsonData.templates || [];
      const newUserId = userToImportFor.id;

      // First pass: create new IDs and map old to new
      const nodeDataToCreate: Partial<TreeNode>[] = nodes.map((node: TreeNode) => {
        const newId = generateClientSideId();
        idMap.set(node.id, newId);
        return {
          ...node,
          _id: newId,
          id: newId,
          children: [], // Children are handled via parentIds
        };
      });

      // Regex to find internal links
      const linkRegex = /node:\/\/([a-zA-Z0-9_.:-]+)/g;

      // Second pass: remap parentIds and internal links
      nodeDataToCreate.forEach((node) => {
        // Remap parentIds
        if (node.parentIds) {
          node.parentIds = node.parentIds.map((pid) => idMap.get(pid)!).filter(Boolean);
        }

        // Remap fields in data
        if (node.data) {
          const template = templates.find((t: Template) => t.id === node.templateId);
          if (template) {
            template.fields.forEach((field: Field) => {
              if (node.data![field.id]) {
                const processValue = (value: string): string => {
                    return value.replace(linkRegex, (match: string, oldId: string) => {
                        return idMap.get(oldId) ? `node://${idMap.get(oldId)}` : match;
                    });
                };
                
                if ((field.type === "link" || field.type === "textarea") && typeof node.data![field.id] === 'string') {
                    node.data![field.id] = processValue(node.data![field.id]);
                }
                // Only rewrite attachment paths if explicitly told to (i.e., for ZIP imports)
                else if (rewriteAttachmentPaths && (field.type === "picture" || field.type === "attachment")) {
                  const value = node.data![field.id];
                  const attachmentRegex = /\/attachments\/([^/]+)\/(.+)/;

                  const rewritePath = (item: string | AttachmentInfo) => {
                    const serverPath = typeof item === "string" ? item : item.path;
                    const match = serverPath.match(attachmentRegex);
                    if (!match) return item; // Not a recognized attachment path

                    const newPath = `/attachments/${newUserId}/${match[2]}`;
                    return typeof item === "string" ? newPath : { ...item, path: newPath };
                  };

                  if (Array.isArray(value)) {
                    node.data![field.id] = value.map(rewritePath);
                  } else if (typeof value === "string" || (typeof value === "object" && (value as any).path)) {
                    node.data![field.id] = rewritePath(value as any);
                  }
                }
              }
            });
          }
        }
      });

      const { id, ...restOfTreeFile } = jsonData;
      const newTreeData = {
        ...restOfTreeFile,
        title: jsonData.title || "Imported Tree",
        userId: userToImportFor.id,
        templates: jsonData.templates || [],
        expandedNodeIds: [],
        order: allTrees.length, // Add to the end by default
      };

      const createdTree = await createTreeFile(newTreeData, []);
      const treeId = createdTree.id;

      const nodesForDb = nodeDataToCreate.map((n) => ({ ...n, treeId, userId: userToImportFor.id }));

      if (nodesForDb.length > 0) {
        await batchCreateNodes(nodesForDb);
      }

      const finalTree = await loadTreeFile(treeId);
      if (finalTree) {
        performAction((draft) => {draft.push(finalTree)}, false);
        _setActiveTreeId(treeId);
        return finalTree.id;
      }
      return null;
    },
    [currentUser, allTrees, performAction]
  );

  const createNewTree = useCallback(
    async (title: string, user?: User): Promise<string | null> => {
      const userToCreateFor = user || currentUser;
      if (!userToCreateFor) return null;
      const newOrder = allTrees.length;
      const { treeFile, initialNodes } = createDefaultTreeFile(title, userToCreateFor.id, newOrder);

      const createdTree = await createTreeFile(
        treeFile,
        initialNodes.map((n: Omit<TreeNode, "id" | "children" | "_id">) => ({ ...n, userId: userToCreateFor.id }))
      );

      const fullCreatedTree = await loadTreeFile(createdTree.id);
      if (fullCreatedTree) {
        performAction((draft) => {draft.push(fullCreatedTree)}, false);
        setActiveTreeId(fullCreatedTree.id);
        console.log(`INFO: Created and loaded new tree '${title}' (ID: ${fullCreatedTree.id}).`);
        return fullCreatedTree.id;
      } else {
        console.error(`ERROR: Failed to reload created tree with ID: ${createdTree.id}`);
        return null;
      }
    },
    [currentUser, allTrees, performAction]
  );

  const reloadActiveTree = useCallback(
    async (treeIdToLoad?: string) => {
      const idToLoad = treeIdToLoad || activeTreeId;
      if (!idToLoad) return;
      console.log(`INFO: Reloading active tree (${idToLoad}) from server.`);
      const reloadedTree = await loadTreeFile(idToLoad);
      if (reloadedTree) {
        performAction((draft) => {
            const index = draft.findIndex(t => t.id === idToLoad);
            if (index > -1) {
                draft[index] = { ...reloadedTree, expandedNodeIds: draft[index].expandedNodeIds };
            }
        }, false);
      } else {
        console.error(`ERROR: Failed to reload tree with ID ${idToLoad}.`);
      }
    },
    [activeTreeId, performAction]
  );

  const loadUserSpecificData = useCallback(
    async (user: User) => {
      setIsTreeDataLoading(true);
      console.log(`INFO: Loading data for user '${user.username}'...`);
      try {
        let loadedTrees = await loadAllTreeFiles(user.id);
        if (loadedTrees.length === 0) {
          console.log(`INFO: No trees found for user '${user.username}'. Loading welcome guide.`);
          const welcomeGuideData = await loadExampleFromFile("welcome-guide.json");
          if (welcomeGuideData) {
            await importTreeFromJson(welcomeGuideData, user, true);
            loadedTrees = await loadAllTreeFiles(user.id);
          } else {
            console.warn("WARN: welcome-guide.json not found. Creating default tree.");
            await createNewTree("My First Tree", user);
            loadedTrees = await loadAllTreeFiles(user.id);
          }
        }
        
        loadedTrees.sort((a,b) => (a.order || 0) - (b.order || 0));

        setAllTrees(() => loadedTrees);
        const lastActiveTreeId = user.lastActiveTreeId;
        if (lastActiveTreeId && loadedTrees.some((t) => t.id === lastActiveTreeId)) {
          _setActiveTreeId(lastActiveTreeId);
        } else {
          _setActiveTreeId(loadedTrees[0]?.id || null);
        }

        console.log(`INFO: Loaded ${loadedTrees.length} trees for user '${user.username}'.`);
      } catch (error) {
        console.error("ERROR: Failed to initialize auth:", error);
      } finally {
        setIsDataLoaded(true);
        setIsTreeDataLoading(false);
      }
    },
    [createNewTree, importTreeFromJson, setAllTrees]
  );

  useEffect(() => {
    if (currentUser && !isDataLoaded) {
      loadUserSpecificData(currentUser);
    } else if (!currentUser && isDataLoaded) {
      // Clear data on logout
      setAllTrees(() => []);
      _setActiveTreeId(null);
      setHistoryStack(() => []);
      setRedoStack(() => []);
      setClipboard({ nodes: null, operation: null });
      setSelectedNodeIds([]);
      setLastSelectedNodeId(null);
      setIsDataLoaded(false);
      setIsTreeDataLoading(true);
      console.log("INFO: User logged out. All tree context state cleared.");
    }
  }, [currentUser, isDataLoaded, loadUserSpecificData, setAllTrees, setHistoryStack, setRedoStack]);

  const debouncedSave = useDebouncedCallback((treeToSave: TreeFile) => {
    if (currentUser) {
        const { tree, ...metaData } = treeToSave;
        saveTreeFile(metaData);
        setIsDirty(false);
        console.log(`INFO: Debounced save for tree '${treeToSave.title}' executed.`);
    }
  }, 1000);

  useEffect(() => {
    if (isDirty && isDataLoaded && activeTree) {
      debouncedSave(activeTree);
    }
  }, [isDirty, isDataLoaded, activeTree, debouncedSave]);

  const setActiveTreeId = (id: string | null) => {
    _setActiveTreeId(id);
    setHistoryStack(() => []);
    setRedoStack(() => []);
    setSelectedNodeIds([]);
    setLastSelectedNodeId(null);
    setLastActiveTreeIdForUser(id);
    if (currentUser && id) {
      const newTreeTitle = allTrees.find((t) => t.id === id)?.title;
      console.log(`INFO: Switched active tree to '${newTreeTitle}' (ID: ${id}).`);
    }
  };

  /* ------------------------------ Tree sharing ------------------------------ */

  const deleteTree = async (id: string) => {
    if (!currentUser) return;
    const treeToDelete = allTrees.find((t) => t.id === id);
    if (!treeToDelete) return;

    try {
      await deleteTreeFileFromDb(id);

      performAction((draft) => {
        const index = draft.findIndex(t => t.id === id);
        if (index > -1) draft.splice(index, 1);
      }, false);

      if (activeTreeId === id) {
        const newActiveId = allTrees.length > 1 ? allTrees.find(t => t.id !== id)?.id || null : null;
        setActiveTreeId(newActiveId);
        if (newActiveId === null) router.push("/roots");
      }

      toast({ title: "Tree Deleted", description: `"${treeToDelete.title}" was permanently deleted.` });
      console.log(`INFO: Deleted tree '${treeToDelete.title}' (ID: ${id}).`);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: `Failed to delete the tree.` });
      await loadUserSpecificData(currentUser);
    }
  };

  const updateTreeOrder = async (updates: { id: string; order: number }[]) => {
    await updateTreeOrderInDb(updates);
    performAction(draft => {
        updates.forEach(({ id, order }) => {
            const tree = draft.find(t => t.id === id);
            if (tree) tree.order = order;
        });
        draft.sort((a,b) => (a.order || 0) - (b.order || 0));
    }, false);
  };

  const shareTree = async (treeId: string, userId: string) => {
    if (!currentUser) return;
  
    const originalTrees = JSON.parse(JSON.stringify(allTrees));
    let updatedTree: TreeFile | undefined;
  
    // Correctly apply the state update first
    setAllTrees(draft => {
      const treeToShare = draft.find((t: TreeFile) => t.id === treeId);
      if (!treeToShare || treeToShare.userId !== currentUser.id) {
        return;
      }
      const sharedWith = treeToShare.sharedWith || [];
      if (sharedWith.includes(userId)) {
        return;
      }
      treeToShare.sharedWith = [...sharedWith, userId];
      updatedTree = JSON.parse(JSON.stringify(treeToShare)); // Get a clean copy for the DB
    });
  
    // Now that the state update is queued, proceed with the DB call
    setTimeout(async () => {
      if (updatedTree) {
        const { tree, ...metaData } = updatedTree;
        try {
          await saveTreeFile(metaData);
          toast({ title: "Tree Shared", description: "The tree is now shared with the selected user." });
        } catch (err) {
          console.error("Failed to save shared tree:", err);
          toast({ variant: "destructive", title: "Error", description: "Could not save sharing changes." });
          setAllTrees(() => originalTrees);
        }
      } else {
        const treeToShare = allTrees.find((t: TreeFile) => t.id === treeId);
        if (!treeToShare || treeToShare.userId !== currentUser.id) {
          toast({ variant: "destructive", title: "Error", description: "You can only share trees you own." });
          return;
        }
        if ((treeToShare.sharedWith || []).includes(userId)) {
          toast({ title: "Already Shared", description: "This tree is already shared with that user." });
        }
      }
    }, 0);
  };
  
  const revokeShare = async (treeId: string, userId: string) => {
    if (!currentUser) return;
    
    const originalTrees = JSON.parse(JSON.stringify(allTrees));
    let updatedTree: TreeFile | undefined;
  
    // Apply state update first
    setAllTrees(draft => {
      const treeToUpdate = draft.find((t: TreeFile) => t.id === treeId);
  
      if (!treeToUpdate || treeToUpdate.userId !== currentUser.id) {
        return;
      }
      treeToUpdate.sharedWith = (treeToUpdate.sharedWith || []).filter(id => id !== userId);
      updatedTree = JSON.parse(JSON.stringify(treeToUpdate));
    });
  
    // Defer DB operation
    setTimeout(async () => {
      if (updatedTree) {
        const { tree, ...metaData } = updatedTree;
        try {
          await saveTreeFile(metaData);
          toast({ title: "Access Revoked", description: "The user's access has been revoked." });
        } catch (err) {
          console.error("Failed to save revoked share:", err);
          toast({ variant: "destructive", title: "Error", description: "Could not save sharing changes." });
          setAllTrees(() => originalTrees);
        }
      } else {
        toast({ variant: "destructive", title: "Error", description: "You can only revoke sharing for trees you own." });
      }
    }, 0);
  };

  const listExamples = async (): Promise<ExampleInfo[]> => {
    return listExamplesFromDataService();
  };

  const loadExample = async (fileName: string): Promise<string | null> => {
    const exampleData = await loadExampleFromFile(fileName);
    if (exampleData) {
      const newTreeId = await importTreeFromJson(exampleData, undefined, true);
      if (newTreeId) {
        toast({ title: "Example Loaded", description: `The "${(exampleData as any).title}" example has been loaded as a new root.` });
        router.push("/");
        return newTreeId;
      }
    }
    toast({ variant: "destructive", title: "Failed to load example", description: `Could not load the example data from ${fileName}.` });
    return null;
  };

  /* ------------------------------ Attachments ------------------------------- */

  const uploadAttachment = async (relativePath: string, dataUri: string, fileName: string, ownerId: string): Promise<AttachmentInfo | null> => {
    if (!ownerId) {
      console.error("ERROR: ownerId is required to upload an attachment.");
      return null;
    }
    try {
      const formData = new FormData();
      formData.append("file", dataUri);
      formData.append("fileName", fileName);
      formData.append("relativePath", relativePath);
      formData.append("userId", ownerId);

      const response = await fetch("/api/upload/attachment", { method: "POST", body: formData });

      if (!response.ok) throw new Error((await response.json()).message || "Upload failed");
      return (await response.json()).attachmentInfo;
    } catch (error) {
      console.error("ERROR: Failed to upload attachment:", error);
      return null;
    }
  };

  const importTreeArchive = async (file: File) => {
    if (!currentUser) throw new Error("You must be logged in to import an archive.");
    console.log(`INFO: Starting archive import: ${file.name}`);
    const { treeFile, files: fileBlobs } = await readArchive(file);

    const uploadPromises = Object.entries(fileBlobs).map(async ([relativePath, blob]) => {
      try {
        const dataUri = await blobToDataURI(blob);
        const originalFileName = path.basename(relativePath);
        await uploadAttachment(originalFileName, dataUri, originalFileName, currentUser.id);
      } catch (error) {
        console.error(`Failed to upload file ${relativePath} from archive`, error);
      }
    });

    await Promise.all(uploadPromises);
    await importTreeFromJson(treeFile, undefined, true);
    console.log(`INFO: Archive '${file.name}' imported successfully.`);
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

  const setTreeTitle = (treeId: string, title: string) => {
    const tree = allTrees.find((t) => t.id === treeId);
    if (!tree || tree.userId !== currentUser?.id) return;
    performAction((draft) => {
      const treeToUpdate = draft.find(t => t.id === treeId);
      if (treeToUpdate) treeToUpdate.title = title;
    }, false);
  };

  const setExpandedNodeIds = (updater: (draft: string[]) => string[] | void) => {
    updateActiveTree(
      (draft) => {
        const currentExpanded = draft.expandedNodeIds;
        const result = typeof updater === 'function' ? updater(currentExpanded) : updater;
        if (result !== undefined) { 
            draft.expandedNodeIds = result;
        }
      },
      false
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
        if (contextualParentId) {
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
    parentIds: nodeData.parentIds ?? [],
    order: nodeData.order ?? [0],
  };
};

const addNodes = async (
  targetNodeId: string | null, // Can be null for root nodes
  nodeDataToAdd: Partial<Omit<TreeNode, "id" | "children">>,
  position: "child" | "sibling" | "root",
  contextualParentId: string | null
) => {
    if (!activeTree || !currentUser || (activeTree.userId !== currentUser.id && !activeTree.sharedWith?.includes(currentUser.id))) {
      toast({
        variant: "destructive",
        title: "Permission Denied",
        description: "You do not have permission to add nodes to this tree.",
      });
      return;
    }
    
    const isOwner = activeTree.userId === currentUser.id;

    const originalTrees = JSON.parse(JSON.stringify(allTrees));
    
    const targetNodeInfo = findNodeAndContextualParent(targetNodeId, contextualParentId);
    
    const parentNode = position === 'child' ? targetNodeInfo?.node : targetNodeInfo?.parent;
    const siblings = parentNode ? parentNode.children : activeTree?.tree;
    
    if (!siblings) {
        console.error("Failed to find a valid sibling list for the new node.");
        return;
    }
    
    const insertIndex = position === 'child' 
        ? siblings.length 
        : (targetNodeInfo ? siblings.findIndex(n => n.id === targetNodeId) + 1 : siblings.length);

    const newNode = createNode(
      { ...nodeDataToAdd, parentIds: parentNode ? [parentNode.id] : [], order: [insertIndex] },
      activeTree.id,
      activeTree.userId // New nodes are always owned by the tree owner
    );

    const { children, ...newNodeForDb } = newNode;
    if (!newNodeForDb) {
      console.error("Failed to prepare node for DB operation.");
      return;
    }
    
    // Optimistic UI update
    performAction((draft) => {
      const activeTreeDraft = draft.find((t) => t.id === activeTreeId);
      if (!activeTreeDraft) return;

      const parentInfo = parentNode ? findNodeAndContextualParent(parentNode.id, contextualParentId, activeTreeDraft.tree) : null;
      const draftSiblings = parentInfo ? parentInfo.node.children : activeTreeDraft.tree;
      
      draftSiblings.splice(insertIndex, 0, newNode);
      resequenceSiblingsForAdd(draftSiblings, parentNode?.id || null);

      if (parentNode) {
        const parentInstanceId = `${parentNode.id}_${contextualParentId || 'root'}`;
        if (!activeTreeDraft.expandedNodeIds.includes(parentInstanceId)) {
          activeTreeDraft.expandedNodeIds.push(parentInstanceId);
        }
      }
    });

    try {
        await createNodeInDb({ ...newNodeForDb, _id: newNodeForDb.id });
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
    if (!activeTree || !currentUser) return;
    const isOwner = activeTree.userId === currentUser.id;
    const isSharedUser = activeTree.sharedWith?.includes(currentUser.id) ?? false;
    
    if (!isOwner && !isSharedUser) {
        toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to delete nodes from this tree.' });
        return;
    }

    const dbDeleteOperations: { id: string; parentId: string | null }[] = [];
    
    instanceIds.forEach(instanceId => {
        const [nodeId, parentIdStr] = instanceId.split('_');
        const parentId = parentIdStr === 'root' ? null : parentIdStr;
        dbDeleteOperations.push({ id: nodeId, parentId });
    });
    
    if (dbDeleteOperations.length > 0) {
        console.log('INFO: Attempting to delete nodes from DB:', dbDeleteOperations);
        await Promise.all(dbDeleteOperations.map(({ id, parentId }) => deleteNodeWithChildren(id, parentId)));
        await reloadActiveTree();
    }
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
          parentIds: newParentId ? [newParentId] : [],
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
      return updatePastedNode(node, parent?.id || null, targetIndex + index);
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
                const oldParentIndex = movingNode.parentIds.indexOf(move.sourceContextualParentId!);
                if (oldParentIndex > -1) {
                    movingNode.parentIds.splice(oldParentIndex, 1);
                    movingNode.order.splice(oldParentIndex, 1);
                }

                if (newParentId && !movingNode.parentIds.includes(newParentId)) {
                    movingNode.parentIds.push(newParentId);
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
        });

        setTimeout(async () => {
            if (finalDbUpdates.length > 0) {
                console.log(`INFO: Batch updating ${finalDbUpdates.length} nodes in DB.`);
                await batchUpdateNodes(finalDbUpdates);
            }
        }, 0);
    };

    /**
     * @important
     * This function's implementation is carefully crafted to work correctly with
     * the Immer library's draft state and the contextual parent logic. It avoids
     * direct order swapping and instead uses the robust `moveNodes` function.
     *
     * DO NOT MODIFY THIS FUNCTION without a deep understanding of the surrounding
     * state management, as it can easily re-introduce subtle bugs related to
     * node reordering and cloned nodes.
     */
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
    if (!newParent) {
        toast({ variant: "destructive", title: "Invalid Operation", description: "Cannot clone at the root level as a sibling." });
        return;
    }

    const siblings = newParent.children || [];
    const targetNodeIndex = as === 'sibling' ? siblings.findIndex(n => n.id === targetNodeId) : -1;
    const baseOrder = as === 'sibling' 
        ? (targetNodeIndex !== -1 ? getContextualOrder(targetNode, siblings, newParent.id) + 1 : siblings.length) 
        : siblings.length;
    
    await Promise.all(nodeIdsToClone.map((nodeId, i) => {
      if (newParent.id === nodeId) {
          toast({ variant: "destructive", title: "Invalid Operation", description: `Cannot clone node as a child of itself.` });
          return Promise.resolve();
      }
      const nodeToClone = findNodeAndParent(nodeId)?.node;
      if (!nodeToClone) return Promise.resolve();
      if (nodeToClone.parentIds.includes(newParent.id)) {
          toast({ title: "Already Exists", description: `Node "${nodeToClone.name}" is already a clone under "${newParent.name}".` });
          return Promise.resolve();
      }
      return addParentToNode(nodeId, newParent.id, baseOrder + i);
    }));

    let dbUpdates: { id: string, updates: Partial<TreeNode> }[] = [];

    performAction(draft => {
        const activeTreeDraft = draft.find(t => t.id === activeTreeId);
        if (!activeTreeDraft) return;
        
        const parentInfo = findNodeAndContextualParent(newParent.id, findNodeAndParent(newParent.id, activeTreeDraft.tree)?.parent?.id || null, activeTreeDraft.tree);
        if (!parentInfo) return;

        const draftSiblings = parentInfo.node.children;
        const draftTargetIndex = draftSiblings.findIndex(n => n.id === targetNodeId);
        const insertIndex = as === 'sibling' ? (draftTargetIndex !== -1 ? draftTargetIndex + 1 : draftSiblings.length) : draftSiblings.length;

        nodeIdsToClone.forEach((nodeId, i) => {
            const originalNodeInDraft = findNodeAndParent(nodeId, activeTreeDraft.tree)?.node;
            if (originalNodeInDraft) {
                if (!originalNodeInDraft.parentIds.includes(newParent.id)) {
                    originalNodeInDraft.parentIds.push(newParent.id);
                    originalNodeInDraft.order.push(baseOrder + i);
                }
                if (!draftSiblings.some(c => c.id === originalNodeInDraft.id)) {
                    draftSiblings.splice(insertIndex + i, 0, originalNodeInDraft);
                }
            }
        });
        
        resequenceSiblingsForAdd(draftSiblings, newParent.id);
        
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
  

  /* ----------------------------- Storage management ------------------------- */

  const analyzeStorage = async (treeId?: string): Promise<StorageInfo> => {
    if (!currentUser) throw new Error("User not authenticated");
    return getStorageInfo(currentUser.id, treeId);
  };

  const purgeStorage = async (treeId?: string): Promise<PurgeResult | null> => {
    if (!currentUser) return null;
    return purgeUnusedFiles(currentUser.id, treeId);
  };

  /* --------------------------------- Git sync -------------------------------- */

  const {
    conflictState,
    resolveConflict,
    linkTreeToRepo,
    unlinkTreeFromRepo,
    createAndLinkTreeToRepo,
    commitToRepo,
    fetchRepoHistory,
    syncFromRepo,
    restoreToCommit,
  } = useGitSync({
    currentUser,
    allTrees,
    performAction,
    importTreeFromJson,
    deleteTree,
    reloadActiveTree,
    setActiveTreeId,
    replaceTree: replaceTree,
  });

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
    listExamples,
    loadExample,
    importTreeArchive,
    importTreeFromJson,
    exportNodesAsJson,
    exportNodesAsArchive,
    exportNodesAsHtml,
    isTreeDataLoading,
    reloadActiveTree,
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
