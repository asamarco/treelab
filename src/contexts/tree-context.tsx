

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
  UseTreeRootsResult,
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

interface TreeContextType extends UseTreeRootsResult {
  // Tree management
  importTemplates: (newTemplates: Template[]) => void;
  // Export Functions
  exportNodesAsJson: (nodes: TreeNode[], baseName: string) => void;
  exportNodesAsArchive: (nodes: TreeNode[], baseName: string) => Promise<void>;
  exportNodesAsHtml: (elementId: string, nodes: TreeNode[], title: string) => void;

  // Active tree properties
  templates: Template[];
  setTemplates: (updater: Template[] | ((current: Template[]) => Template[])) => void;
  tree: TreeNode[];

  // Tree meta/UI
  treeTitle: string;
  expandedNodeIds: string[];
  
  expandAllFromNode: (nodes: { nodeId: string; parentId: string | null }[]) => void;
  collapseAllFromNode: (nodes: { nodeId: string; parentId: string | null }[]) => void;


  // Utility
  getTemplateById: (id: string) => Template | undefined;
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
    treeRootsHook.expandAllFromNode(nodesToExpand);
  };

  const collapseAllFromNode = (nodesToCollapse: { nodeId: string, parentId: string | null }[]) => {
    treeRootsHook.collapseAllFromNode(nodesToCollapse);
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
    
    
