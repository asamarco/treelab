

/**
 * @fileoverview
 * This file defines the core TypeScript types and interfaces used throughout the application.
 * Centralizing these types ensures consistency and provides a single source of truth for
 * the data structures, such as templates, tree nodes, users, and settings.
 * This improves code maintainability and type safety across the project.
 */

export type FieldType = "text" | "number" | "date" | "dropdown" | "textarea" | "link" | "picture" | "table-header" | "dynamic-dropdown" | "attachment";
export type Theme = "light" | "dark" | "system";

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  options?: string[]; // For dropdown
  columnType?: 'text' | 'number' | 'date'; // For table-header
  width?: number; // for picture
  prefix?: string;
  postfix?: string;
}

export interface AttachmentInfo {
  path: string; // Server path to the file
  name: string; // Original file name
  size: number; // File size in bytes
  type: string; // Mime type
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

export interface Template {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  fields: Field[];
  nameTemplate?: string;
  bodyTemplate?: string;
  conditionalRules: ConditionalRule[];
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
    gitSettings?: GitSettings;
}

export interface GlobalSettings {
    _id?: any; // Mongoose internal
    allowPublicRegistration: boolean;
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

    