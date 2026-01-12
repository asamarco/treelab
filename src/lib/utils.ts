

/**
 * @fileoverview
 * This file contains utility functions used across the application.
 *
 * `cn`: A helper function that merges Tailwind CSS classes from `clsx` and `tailwind-merge`,
 *       allowing for conditional and cleaner class name management in components.
 *
 * `deepCloneNode`: A function to create a deep clone of a `TreeNode` object, including
 *                  all its children, while assigning new unique IDs to each cloned node.
 *                  This is crucial for copy/paste functionality to avoid reference issues.
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { TreeNode, Template, TreeFile } from "./types";
import { format, parse, isValid, parseISO } from "date-fns";
import path from 'path';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateClientSideId() {
  // Use hyphens instead of underscores to avoid conflicts with the instanceId delimiter.
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

export function deepCloneNode(node: TreeNode): TreeNode {
  const newId = generateClientSideId();
  const clonedNode: TreeNode = {
    ...node,
    id: newId,
    _id: newId,
    children: (node.children || []).map(child => deepCloneNode(child)),
  };
  return clonedNode;
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export const formatDate = (dateValue: string | Date, formatString: string = 'dd/MM/yyyy'): string => {
  if (!dateValue) return '';
  let date: Date;

  if (typeof dateValue === 'string') {
    // Check if it's already in 'yyyy-MM-dd' format from the date picker state
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      date = parse(dateValue, 'yyyy-MM-dd', new Date());
    } else {
      // Otherwise, assume it's an ISO string from the database
      date = parseISO(dateValue);
    }
  } else {
    date = dateValue;
  }
  
  if (isValid(date)) {
    try {
      // Use PPP for Month Day, Year format
      if (formatString === 'PPP') {
        return format(date, 'PPP');
      }
      return format(date, formatString);
    } catch (e) {
      // Fallback for invalid format strings
      console.warn(`Invalid date format string "${formatString}". Falling back to default.`);
      return format(date, 'dd/MM/yyyy');
    }
  }
  
  // Return the original string if all parsing fails
  return String(dateValue);
};


export const generateNodeName = (template: Template, data: Record<string, any>, nameTemplate?: string): string => {
  const templateString = nameTemplate ?? template.nameTemplate;
  if (!templateString) {
    return "Untitled Node";
  }

  const name = templateString.replace(/\{([^}]+)\}/g, (match, fieldName) => {
    const field = template.fields.find(f => f.name === fieldName.trim());
    if (!field) {
      return match; 
    }

    let value = data[field.id];

    if (value === undefined || value === null || value === "") {
      return "";
    }
    
    let formattedValue = String(value);

    if (field.type === "date" && typeof value === 'string') {
        // Since this utility doesn't have access to the user context for the format string,
        // we'll use a standard, unambiguous format here.
        // The more complex formatting is handled in the display components.
        formattedValue = formatDate(value, 'PPP');
    }
    
    if (formattedValue) {
        return `${field.prefix || ''}${formattedValue}${field.postfix || ''}`;
    }

    return formattedValue;
  });

  return name.trim() || "Untitled Node";
};


/**
 * Generates a JSON object for export or Git commit, ensuring a consistent, flat format.
 * This function is the single source of truth for the export structure.
 * 
 * @param {string} title - The title of the tree.
 * @param {TreeNode[]} nodesToExport - An array of the root-level nodes to be included in the export.
 * @param {Template[]} allTemplates - The complete list of templates associated with the tree.
 * @returns {Partial<TreeFile>} A serializable object with the following fixed structure:
 *   - `title`: {string} The title of the tree.
 *   - `nodes`: {Array<Omit<TreeNode, 'children' | '_id'>>} A **flat array** of all nodes included in the export (root nodes and all their descendants). The hierarchical structure is maintained via the `parentIds` property on each node. The `children` array is explicitly removed from each node.
 *   - `templates`: {Template[]} The complete array of templates for this tree.
 *   - `rootNodeIds`: {string[]} An array of node IDs corresponding to the root nodes passed into `nodesToExport`. This is used to reconstruct the tree's top level.
 */
export const generateJsonForExport = (
  title: string,
  nodesToExport: TreeNode[],
  allTemplates: Template[]
): Partial<TreeFile> => {
    const flattenedNodes: Omit<TreeNode, 'children' | '_id'>[] = [];
    const visitedNodeIds = new Set<string>();

    const getDescendantsAndSelf = (nodes: TreeNode[]) => {
        for(const node of nodes) {
            if(!visitedNodeIds.has(node.id)) {
                // FIX: Perform a deep clone to prevent read-only errors on import/duplication.
                const deepClonedNode = JSON.parse(JSON.stringify(node));
                const { children, _id, ...nodeToKeep } = deepClonedNode;
                flattenedNodes.push(nodeToKeep);
                visitedNodeIds.add(node.id);
            }
            if (node.children) {
                getDescendantsAndSelf(node.children);
            }
        }
    };
    getDescendantsAndSelf(nodesToExport);

    return {
        title: title,
        nodes: flattenedNodes,
        templates: allTemplates,
        rootNodeIds: nodesToExport.map(n => n.id)
    };
};

export const getContextualOrder = (node: TreeNode, siblings: readonly TreeNode[], contextualParentId: string | null): number => {
  const pIndex = contextualParentId ? (node.parentIds || []).indexOf(contextualParentId) : (node.parentIds || []).indexOf('root');
  
  const siblingArray = Array.isArray(siblings) ? siblings : [];
  const fallbackOrder = siblingArray.findIndex((s: any) => s.id === node.id);
  // Ensure we don't get -1 if the parentId is not found (which can happen during some state transitions)
  const finalPIndex = pIndex === -1 ? 0 : pIndex; 
  return (finalPIndex !== -1 && node.order && node.order.length > finalPIndex) ? node.order[finalPIndex] : (fallbackOrder !== -1 ? fallbackOrder : 0);
}
