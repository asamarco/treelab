/**
 * @fileoverview
 * This file defines the core TypeScript types and interfaces used throughout the application.
 * Centralizing these types ensures consistency and provides a single source of truth for
 * the data structures, such as templates, tree nodes, users, and settings.
 * This improves code maintainability and type safety across the project.
 */
import type { WritableDraft } from 'immer';
import React, { Dispatch, SetStateAction } from 'react';
import { useToast } from '@/hooks/use-toast';

export type FieldType = "text" | "number" | "date" | "dropdown" | "textarea" | "link" | "picture" | "table-header" | "dynamic-dropdown" | "attachment" | "xy-chart" | "query" | "checklist" | "checkbox";
export type Theme = "light" | "dark" | "system";

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  options?: string[]; // For dropdown
  columnType?: 'text' | 'number' | 'date'; // For table-header
  height?: number; // for picture
  prefix?: string;
  postfix?: string;
}

export interface AttachmentInfo {
  path: string; // Server path to the file
  name: string; // Original file name
  size: number; // File size in bytes
  type: string; // Mime type
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export type ConditionalRuleOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains' 
  | 'is_not_empty'
  | 'is_empty'
  | 'greater_than'
  | 'less_than';

export interface ConditionalRule {
  id: string;
  fieldId: string;
  operator: ConditionalRuleOperator;
  value: string;
  icon: string;
  color: string;
}

export interface SimpleQueryRule {
  id: string;
  fieldId: string;
  operator: ConditionalRuleOperator;
  value: string;
}

export type RuleType = 'field' | 'ancestor' | 'descendant';

export interface QueryRule {
  id: string;
  type: RuleType;

  // for type: 'field'
  fieldId?: string;
  operator?: ConditionalRuleOperator;
  value?: string;
  
  // for type: 'ancestor' | 'descendant'
  relationTemplateId?: string | null;
  relationRules?: SimpleQueryRule[];
}

export interface QueryDefinition {
  id: string;
  targetTemplateId: string | null;
  rules: QueryRule[];
}


export interface Template {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  fields: Field[];
  nameTemplate?: string;
  bodyTemplate?: string;
  conditionalRules: ConditionalRule[];
  preferredChildTemplates?: string[];
}

export interface XYChartData {
  points: { x: string; y: string }[];
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface TreeNode {
  id: string;
  _id?: any;
  syncId?: string; // The ID used for git syncing, shared across different users/trees
  name: string;
  templateId: string;
  data: Record<string, any>;
  children: TreeNode[]; // This will be populated in memory
  isStarred?: boolean;
  userId: string;
  treeId: string;
  parentIds: string[];
  order: number[];
  createdAt?: string;
  updatedAt?: string;
}

export interface GitSync {
  repoOwner: string;
  repoName: string;
  branch: string;
  lastSync: string;
  lastSyncSha?: string;
}

export interface TreeFile {
    id: string;
    _id?: any; // Mongoose internal
    userId: string;
    title: string;
    order: number;
    isPublic?: boolean;
    // The 'tree' property is now virtual and will be loaded separately
    tree: TreeNode[]; // Still used on the client-side after reconstruction
    templates: Template[];
    expandedNodeIds: string[];
    gitSync?: GitSync;
    sharedWith?: string[];
    createdAt: string;
    updatedAt: string;
    // Properties for the new flattened JSON format
    nodes?: Omit<TreeNode, 'children' | '_id'>[];
    rootNodeIds?: string[];
}

export interface ExampleInfo {
    fileName: string;
    title: string;
}

export interface GitSettings {
    githubPat?: string;
}

export interface GitProvider {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
}

export interface GitBlob {
    path: string;
    mode: '100644' | '100755' | '040000' | '160000' | '120000';
    type: 'blob' | 'tree' | 'commit';
    sha: string | null;
}

export interface GitCommit {
    sha: string;
    message: string;
    author: string;
    date: string;
}

export interface User {
    id: string;
    _id?: any; // Mongoose internal
    username: string;
    passwordHash: string;
    salt: string;
    isAdmin: boolean;
    lastActiveTreeId?: string | null;
    theme?: Theme;
    dateFormat?: string;
    inactivityTimeoutMinutes?: number;
    gitSettings?: GitSettings;
}

export interface GlobalSettings {
    _id?: any; // Mongoose internal
    allowPublicRegistration: boolean;
    customLogoPath?: string;
    updatedAt?: string;
}

export interface ArchiveData {
    treeFile: TreeFile;
    files: Record<string, Blob>;
}

export interface StorageInfo {
    totalSize: number;
    totalCount: number;
    purgeableSize: number;
    purgeableCount: number;
}

export interface PurgeResult {
    purgedSize: number;
    purgedCount: number;
}

// --- Command Pattern Types ---
interface BaseCommand {
  type: string;
  execute: (draft: WritableDraft<TreeFile[]>) => any;
  undo: (timestamp?: string) => Promise<void>;
  redo?: (finalTreeFile?: TreeFile, timestamp?: string) => Promise<void>;
  post?: (finalTreeFile?: TreeFile, timestamp?: string) => Promise<void>;
  getUndoState?: (draft: WritableDraft<TreeFile[]>, command: Command) => void;
}

export interface AddNodesCommand extends BaseCommand {
    type: 'ADD_NODES';
    payload: {
        nodes: TreeNode[];
    };
    originalState: {
        siblingOrders: { id: string, order: number[] }[];
    };
}

export interface DeleteNodesCommand extends BaseCommand {
    type: 'DELETE_NODES';
    payload: {
        nodes: { nodeId: string; parentId: string | null }[];
    };
    originalState: { 
        node: TreeNode, 
        parent: TreeNode | null, 
        originalSiblings: TreeNode[],
        allDeletedNodes: TreeNode[],
    }[];
}

export interface MoveNodesCommand extends BaseCommand {
    type: 'MOVE_NODES';
    payload: {
        moves: {
            nodeId: string;
            targetNodeId: string;
            position: 'child' | 'sibling' | 'child-bottom';
            sourceContextualParentId: string | null;
            targetContextualParentId: string | null;
        }[];
    };
    originalState: { tree: TreeNode[] };
}

export interface UpdateNodesCommand extends BaseCommand {
    type: 'UPDATE_NODES';
    payload: { nodeId: string, updates: Partial<TreeNode>, originalData: Partial<TreeNode> }[];
}

export interface ReorderNodesCommand extends BaseCommand {
    type: 'REORDER_NODES';
    payload: { nodeId: string, updates: Partial<TreeNode>, originalData: Partial<TreeNode> }[];
}

export interface PasteAsClonesCommand extends BaseCommand {
    type: 'PASTE_AS_CLONES';
    payload: {
        clones: {
            nodeId: string;
            newParentId: string | null;
            newOrder: number;
        }[];
    };
    originalState: {};
}

export interface UpdateTreeFileCommand extends BaseCommand {
    type: 'UPDATE_TREE_FILE';
    payload: {
        treeId: string;
        updates: Partial<Omit<TreeFile, 'id' | 'tree'>>;
    };
    originalState: Partial<Omit<TreeFile, 'id' | 'tree'>>;
}

export interface ExpandCollapseCommand extends BaseCommand {
    type: 'EXPAND_COLLAPSE_NODES';
    payload: {
        treeId: string;
        newIds: string[];
    };
    originalState: {
        expandedNodeIds: string[];
    }
}

export interface LocalOnlyUpdateCommand extends BaseCommand {
    type: 'LOCAL_ONLY_UPDATE';
}


export type Command = AddNodesCommand | DeleteNodesCommand | MoveNodesCommand | UpdateNodesCommand | UpdateTreeFileCommand | ExpandCollapseCommand | ReorderNodesCommand | PasteAsClonesCommand | LocalOnlyUpdateCommand;

export interface ClipboardState {
    nodes: TreeNode[] | null;
    operation: 'copy' | 'cut' | null;
}

export interface ActionContext {
  activeTree?: TreeFile;
  currentUser?: User | null;
  activeTreeId?: string | null;
  executeCommand: (command: Command, isUndoable?: boolean) => any;
  findNodeAndParent: (nodeId: string, nodes?: TreeNode[]) => { node: TreeNode; parent: TreeNode | null; } | null;
  findNodeAndContextualParent: (nodeId: string | null, contextualParentId: string | null, nodes?: TreeNode[]) => { node: TreeNode; parent: TreeNode | null; } | null;
  allTrees: TreeFile[];
  isCloneOrDescendant?: (nodeId: string, nodes?: TreeNode[]) => boolean;
  reloadActiveTree?: () => Promise<void>;
  clipboard?: ClipboardState;
  toast?: ReturnType<typeof useToast>['toast'];
  getSiblingOrderRange?: (siblings: TreeNode[], parentId: string | null) => { minOrder: number; maxOrder: number };
  selectedNodeIds?: string[];
  getTemplateById?: (id: string) => Template | undefined;
}

export interface UseTreeRootsResult {
  allTrees: TreeFile[];
  setAllTrees: Dispatch<SetStateAction<TreeFile[]>>;
  activeTree: TreeFile | undefined;
  activeTreeId: string | null;
  isTreeDataLoading: boolean;
  conflictState: { localTree: TreeFile, serverTree: TreeFile } | null;
  setActiveTreeId: (id: string | null) => void;
  createNewTree: (title: string, user?: User | undefined) => Promise<string | null>;
  deleteTree: (id: string) => Promise<void>;
  duplicateTree: (treeId: string) => Promise<void>;
  updateTreeOrder: (updates: { id: string; order: number; }[]) => Promise<void>;
  shareTree: (treeId: string, userId: string) => Promise<void>;
  revokeShare: (treeId: string, userId: string) => Promise<void>;
  setTreePublicStatus: (treeId: string, isPublic: boolean) => Promise<void>;
  listExamples: () => Promise<ExampleInfo[]>;
  loadExample: (fileName: string) => Promise<string | null>;
  importTreeArchive: (file: File) => Promise<void>;
  importTreeFromJson: (jsonData: any, user?: User | undefined, rewriteAttachmentPaths?: boolean) => Promise<string | null>;
  reloadAllTrees: () => Promise<void>;
  reloadActiveTree: (treeIdToLoad?: string) => Promise<void>;
  setTreeTitle: (treeId: string, title: string) => void;
  setTemplates: (updater: Template[] | ((current: Template[]) => Template[])) => void;
  importTemplates: (newTemplates: Template[]) => void;
  expandedNodeIds: string[];
  setExpandedNodeIds: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
  expandAllFromNode: (nodes: { nodeId: string; parentId: string | null; }[]) => void;
  expandToNode: (nodeId: string) => void;
  collapseAllFromNode: (nodes: { nodeId: string; parentId: string | null; }[]) => void;
  addRootNode: (nodeData: Partial<Omit<TreeNode, "id" | "children">>) => Promise<void>;
  addChildNode: (parentNodeId: string, childNodeData: Partial<Omit<TreeNode, "id" | "children">>, contextualParentId: string | null) => Promise<void>;
  addSiblingNode: (siblingNodeId: string, nodeToAddData: Partial<Omit<TreeNode, 'id' | 'children'>>, contextualParentId: string | null) => Promise<void>;
  updateNode: (nodeId: string, newNodeData: Partial<Omit<TreeNode, "id" | "children">>) => Promise<void>;
  updateNodeNamesForTemplate: (template: Template) => Promise<void>;
  changeNodeTemplate: (nodeId: string, newTemplateId: string) => Promise<void>;
  changeMultipleNodesTemplate: (instanceIds: string[], newTemplateId: string) => Promise<void>;
  deleteNode: (nodeId: string, contextualParentId: string | null) => Promise<void>;
  deleteNodes: (instanceIds: string[]) => Promise<void>;
  pasteNodes: (targetNodeId: string, position: "child" | "sibling", contextualParentId: string | null, nodes?: TreeNode[] | undefined) => Promise<void>;
  moveNodes: (moves: { nodeId: string; targetNodeId: string; position: "child" | "sibling" | "child-bottom"; sourceContextualParentId: string | null; targetContextualParentId: string | null; }[]) => Promise<void>;
  moveNodeOrder: (nodeId: string, direction: "up" | "down", contextualParentId: string | null) => Promise<void>;
  pasteNodesAsClones: (targetNodeId: string, as: "child" | "sibling", nodeIdsToClone: string[], contextualParentId: string | null) => Promise<void>;
  undoLastAction: () => void;
  canUndo: boolean;
  redoLastAction: () => void;
  canRedo: boolean;
  undoActionDescription: string | null;
  redoActionDescription: string | null;
  getSiblingOrderRange: (siblings: TreeNode[], parentId: string | null) => { minOrder: number; maxOrder: number; };
  findNodeAndParent: (nodeId: string, nodes?: TreeNode[] | undefined) => { node: TreeNode; parent: TreeNode | null; } | null;
  findNodeAndContextualParent: (nodeId: string | null, contextualParentId: string | null, nodes?: TreeNode[] | undefined) => { node: TreeNode; parent: TreeNode | null; } | null;
  getNodeInstancePaths: (nodeId: string) => string[];
  uploadAttachment: (relativePath: string, dataUri: string, fileName: string) => Promise<AttachmentInfo>;
  commitToRepo: (treeId: string, message: string, token: string, force?: boolean, treeFileToCommit?: TreeFile) => Promise<{ success: boolean; error?: string | undefined; commitSha?: string | undefined; }>;
  fetchRepoHistory: (treeFile: TreeFile, token: string) => Promise<GitCommit[]>;
  syncFromRepo: (treeFile: TreeFile, token: string) => Promise<{ success: boolean; message: string; }>;
  restoreToCommit: (currentTreeId: string, commitSha: string, token: string) => Promise<void>;
  resolveConflict: (resolution: "local" | "server") => Promise<void>;
  analyzeStorage: (treeId?: string | undefined) => Promise<StorageInfo>;
  purgeStorage: (treeId?: string | undefined) => Promise<PurgeResult | null>;
  toggleStarredForSelectedNodes: () => Promise<void>;
  batchUpdateNodeData: (instanceIds: string[], data: Record<string, any>) => Promise<void>;
  clipboard: ClipboardState;
  setClipboard: Dispatch<SetStateAction<ClipboardState>>;
  selectedNodeIds: string[];
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  lastSelectedNodeId: string | null;
  setLastSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  linkTreeToRepo: (treeId: string, repoOwner: string, repoName: string, branch: string, token: string) => Promise<void>;
  unlinkTreeFromRepo: (treeId: string) => void;
  createAndLinkTreeToRepo: (treeId: string, repoName: string, isPrivate: boolean, token: string) => Promise<void>;
  updateActiveTree: (updater: (draft: TreeFile) => void) => void;
  // Properties that were missing from TreeContextType
  templates: Template[];
  tree: TreeNode[];
  treeTitle: string;
  getTemplateById: (id: string) => Template | undefined;
  findNodesByQuery: (query: QueryDefinition) => TreeNode[];
  exportNodesAsJson: (nodesToExport: TreeNode[], baseName: string) => void;
  exportNodesAsArchive: (nodes: TreeNode[], baseName: string) => Promise<void>;
  exportNodesAsHtml: (elementId: string, nodes: TreeNode[], title: string) => void;
}

export type TreeContextType = UseTreeRootsResult;
