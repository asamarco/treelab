

/**
 * NOTE: Literal HTML tags in node names and body-templates are no longer interpreted
 * as markup as of this change — use Markdown syntax instead (**bold**, _italic_, `code`, etc.).
 */

/**
 * @fileoverview
 * This component, `RenderWithLinks`, is a utility for rendering text content
 * that may contain URLs. It parses the input text, identifies URLs that correspond
 * to 'link' fields in the node's data, and transforms them into clickable `<a>` tags.
 *
 * This allows for rich text display within tree nodes, automatically making
 * specified links interactive. Other text is rendered as-is.
 *
 * Supported placeholder syntax:
 *   {FieldName}             — field value on the current node
 *   ?{FieldName}            — same, but keeps the line even when empty
 *   {parent:FieldName}      — field value from the immediate parent in the
 *                             ancestry chain this instance was rendered under
 *   {ancestor:FieldName:N}  — field value from exactly N levels up (N >= 1);
 *                             resolves empty if that depth has no value — no fallback
 *   {child:FieldName}       — field value from the first direct child (in child
 *                             array order) that has a non-empty value for it
 *   {count} / {count:N}     — count of descendants at depth N (N >= 1, default N=1 for direct children)
 */
"use client";

import React, { useContext } from 'react';
import { TreeNode, Template } from '@/lib/types';
import { Link as LinkIcon } from 'lucide-react';
import { TreeContext } from '@/contexts/tree-context';
import { UIContext } from '@/contexts/ui-context';
import { Button } from '../ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AuthContext } from '@/contexts/auth-context';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { resolveTemplateText } from '@/lib/template-text';

export { resolveTemplateText };


interface RenderWithLinksProps {
  node: TreeNode;
  template: Template;
  text: string;
  /**
   * The chain of ancestor nodes for this specific rendering instance, ordered
   * from the tree root down to (but NOT including) the current node.
   * ancestorChain[ancestorChain.length - 1] is the immediate parent.
   * Defaults to [] so existing callers that don't pass it still work.
   */
  ancestorChain?: TreeNode[];
}

// Regex to find standard URLs or our custom node:// links.
const URL_REGEX = /(https?:\/\/[^\s"'<>`]+)|(node:\/\/[\w.:-]+)/g;

/**
 * Extended placeholder regex — matches (in priority order):
 *   1. {count} or {count:N}
 *   2. {parent:FieldName}
 *   3. {ancestor:FieldName:N}
 *   4. {child:FieldName}
 *   5. {FieldName}       (existing — current node)
 *   6. ?{FieldName}      (existing — current node, keep-alive)
 */
const PLACEHOLDER_REGEX =
  /\{count(?::(\d+))?\}|\{parent:([^}]+)\}|\{ancestor:([^}:]+):(\d+)\}|\{child:([^}]+)\}|\{([^}]+)\}|\?\{([^}]+)\}/g;

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Look up a field value by field *name* on a target node, cross-referencing
 * the target node's own template (which may differ from the current node's).
 * Returns undefined when the field doesn't exist, is a non-text type, or is empty.
 */
function getFieldValueFromNode(
  targetNode: TreeNode,
  fieldName: string,
  allTemplates: Template[],
  dateFormat: string | undefined,
): string | undefined {
  const tpl = allTemplates.find(t => t.id === targetNode.templateId);
  if (!tpl) return undefined;
  const field = tpl.fields.find(f => f.name === fieldName);
  if (!field) return undefined;
  if (field.type === 'picture' || field.type === 'table-header' || field.type === 'attachment') return undefined;

  const raw = (targetNode.data || {})[field.id];
  const isEmpty =
    raw === undefined ||
    raw === null ||
    (typeof raw === 'string' && raw.trim() === '') ||
    (Array.isArray(raw) && raw.length === 0);
  if (isEmpty) return undefined;

  let formatted = String(raw);
  if (field.type === 'date' && typeof raw === 'string') {
    formatted = formatDate(raw, dateFormat);
  }
  if (formatted) {
    formatted = `${field.prefix || ''}${formatted}${field.postfix || ''}`;
  }
  return formatted || undefined;
}

/** {parent:FieldName} — reads ancestorChain[last]. */
function resolveParentValue(
  ancestorChain: TreeNode[],
  fieldName: string,
  allTemplates: Template[],
  dateFormat: string | undefined,
): string | undefined {
  if (ancestorChain.length === 0) return undefined;
  return getFieldValueFromNode(ancestorChain[ancestorChain.length - 1], fieldName, allTemplates, dateFormat);
}

/**
 * {ancestor:FieldName:N} — reads ancestorChain[last - (N-1)].
 * N=1 is the immediate parent, N=2 is the grandparent, etc.
 * Out-of-bounds → undefined (no fallback).
 */
function resolveAncestorValue(
  ancestorChain: TreeNode[],
  fieldName: string,
  depth: number,
  allTemplates: Template[],
  dateFormat: string | undefined,
): string | undefined {
  if (depth < 1) return undefined;
  const idx = ancestorChain.length - depth;
  if (idx < 0) return undefined;
  return getFieldValueFromNode(ancestorChain[idx], fieldName, allTemplates, dateFormat);
}

/**
 * {child:FieldName} — iterates node.children in array order, returns the
 * first non-empty value. Never recurses into grandchildren.
 */
function resolveChildValue(
  node: TreeNode,
  fieldName: string,
  allTemplates: Template[],
  dateFormat: string | undefined,
): string | undefined {
  for (const child of (node.children || [])) {
    const val = getFieldValueFromNode(child, fieldName, allTemplates, dateFormat);
    if (val !== undefined) return val;
  }
  return undefined;
}

/**
 * Counts descendants at relative depth N (N=1 is direct children, N=2 is grandchildren, etc.).
 */
function countDescendantsAtDepth(node: TreeNode, depth: number): number {
  if (depth < 1) return 0;
  let currentNodes: TreeNode[] = node.children || [];
  for (let d = 1; d < depth; d++) {
    const nextNodes: TreeNode[] = [];
    for (const n of currentNodes) {
      if (n.children && n.children.length > 0) {
        nextNodes.push(...n.children);
      }
    }
    currentNodes = nextNodes;
    if (currentNodes.length === 0) break;
  }
  return currentNodes.length;
}

// ---------------------------------------------------------------------------
// URL / HTML rendering helper (shared between fast-path and placeholder path)
// ---------------------------------------------------------------------------

function renderParts(
  parts: string[],
  uiContext: any,
  treeContext: any,
  handleJumpToNode: (e: React.MouseEvent, nodeId: string) => void,
) {
  return parts.map((part, index) => {
    if (part.startsWith('node://')) {
      const nodeId = part.substring(7);
      const linkedNodeInfo = treeContext?.findNodeAndParent(nodeId);
      const nodeName = linkedNodeInfo ? linkedNodeInfo.node.name : 'Invalid Link';
      // If context is not available (e.g., during static export), render as plain text.
      if (!uiContext || !treeContext) return <span key={index} className="font-semibold">{nodeName}</span>;
      return <Button key={index} variant="link" className="p-0 h-auto" onClick={(e) => handleJumpToNode(e, nodeId)}>{nodeName}</Button>;
    }
    if (part.match(/https?:\/\//)) {
      return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline">{part}</a>;
    }
    return (
      <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
        {part}
      </ReactMarkdown>
    );
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RenderWithLinks({ node, template, text, ancestorChain = [] }: RenderWithLinksProps) {
  const uiContext = useContext(UIContext);
  const treeContext = useContext(TreeContext);
  const authContext = useContext(AuthContext);
  const currentUser = authContext?.currentUser;

  if (!text) return null;

  const handleJumpToNode = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    treeContext?.selectAndCenterNode({ nodeId });
  };

  const allTemplates = treeContext?.templates ?? [template];
  const dateFormat = currentUser?.dateFormat;

  const resolvedLines = resolveTemplateText(
    text,
    node,
    template,
    allTemplates,
    ancestorChain,
    dateFormat
  );

  const processedLines = resolvedLines.map((line, lineIndex) => {
    const parts = line.split(URL_REGEX).filter(Boolean);
    return (
      <React.Fragment key={lineIndex}>
        {renderParts(parts, uiContext, treeContext, handleJumpToNode)}
      </React.Fragment>
    );
  });

  return (
    <span className="inline">
      {processedLines.map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 && <br />}
          {line}
        </React.Fragment>
      ))}
    </span>
  );
}
