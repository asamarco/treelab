

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
import parseHtml, { domToReact, attributesToProps, DOMNode } from 'html-react-parser';
import { AuthContext } from '@/contexts/auth-context';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';


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
    return parseHtml(part, {
      replace: (domNode) => {
        if ('attribs' in domNode) {
          const props = attributesToProps(domNode.attribs);
          // Remove any on* event handlers
          for (const prop in props) {
            if (prop.toLowerCase().startsWith('on')) {
              delete (props as any)[prop];
            }
          }
          // Sanitize href attributes
          if (domNode.name === 'a' && props.href) {
            const href = props.href as string;
            if (!href.startsWith('http') && !href.startsWith('https') && !href.startsWith('mailto:') && !href.startsWith('node://')) {
              delete props.href;
            }
          }
          return React.createElement(domNode.name, props, domToReact((domNode as any).children));
        }
      }
    });
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
  const { toast } = useToast();

  if (!text) return null;

  const handleJumpToNode = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    treeContext?.selectAndCenterNode({ nodeId });
  };

  // All templates — needed for cross-template field resolution in parent / ancestor / child.
  const allTemplates = treeContext?.templates ?? [template];
  const dateFormat = currentUser?.dateFormat;

  const nodeData = node.data || {};

  const lines = text.split('\n');
  const processedLines = lines.map((line, lineIndex) => {
    const placeholders = Array.from(line.matchAll(PLACEHOLDER_REGEX));

    if (placeholders.length === 0) {
      // Fast path: no placeholders — just handle URLs.
      const parts = line.split(URL_REGEX).filter(Boolean);
      return (
        <React.Fragment key={lineIndex}>
          {renderParts(parts, uiContext, treeContext, handleJumpToNode)}
        </React.Fragment>
      );
    }

    // -------------------------------------------------------------------------
    // Classify each match.
    // -------------------------------------------------------------------------

    type MatchKind = 'count' | 'parent' | 'ancestor' | 'child' | 'current' | 'current-keepalive';

    interface MatchInfo {
      match: RegExpMatchArray;
      kind: MatchKind;
      fieldName?: string;
      depth?: number;
    }

    const matchInfos: MatchInfo[] = placeholders.map(match => {
      if (match[0].startsWith('{count')) {
        const depth = match[1] !== undefined ? parseInt(match[1], 10) : 1;
        return { match, kind: 'count' as MatchKind, depth };
      }
      if (match[2] !== undefined) return { match, kind: 'parent'   as MatchKind, fieldName: match[2].trim() };
      if (match[3] !== undefined) return { match, kind: 'ancestor' as MatchKind, fieldName: match[3].trim(), depth: parseInt(match[4], 10) };
      if (match[5] !== undefined) return { match, kind: 'child'    as MatchKind, fieldName: match[5].trim() };
      if (match[6] !== undefined) return { match, kind: 'current'  as MatchKind, fieldName: match[6].trim() };
      return                             { match, kind: 'current-keepalive' as MatchKind, fieldName: match[7].trim() };
    });

    const resolveMatch = (info: MatchInfo): string | undefined => {
      switch (info.kind) {
        case 'count':
          return String(countDescendantsAtDepth(node, info.depth ?? 1));
        case 'parent':
          return resolveParentValue(ancestorChain, info.fieldName!, allTemplates, dateFormat);
        case 'ancestor':
          return resolveAncestorValue(ancestorChain, info.fieldName!, info.depth!, allTemplates, dateFormat);
        case 'child':
          return resolveChildValue(node, info.fieldName!, allTemplates, dateFormat);
        case 'current':
        case 'current-keepalive': {
          const field = template.fields.find(f => f.name === info.fieldName);
          if (!field || field.type === 'picture' || field.type === 'table-header' || field.type === 'attachment') {
            return undefined;
          }
          const raw = nodeData[field.id];
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
      }
    };

    // -------------------------------------------------------------------------
    // Line suppression
    //
    // Suppress the line when:
    //   - All placeholders resolve to undefined
    //   - No placeholder is keep-alive (?{Field})
    //
    // Special cases that always block suppression:
    //   - {count}  — always resolves (to "0" or more)
    //   - {Field} where no matching field exists — legacy: keep as-is, count as content
    // -------------------------------------------------------------------------
    const hasAnyKeepAlive = matchInfos.some(i => i.kind === 'current-keepalive');

    const hasAnyValue = matchInfos.some(i => {
      if (i.kind === 'count') return true;
      // Legacy: unrecognised field name on current node keeps the line (matches old behaviour).
      if (i.kind === 'current' || i.kind === 'current-keepalive') {
        const field = template.fields.find(f => f.name === i.fieldName);
        if (!field) return true;
      }
      return resolveMatch(i) !== undefined;
    });

    if (!hasAnyValue && !hasAnyKeepAlive) return null;

    // -------------------------------------------------------------------------
    // Build the substituted string.
    // -------------------------------------------------------------------------
    let lastIndex = 0;
    const segments: string[] = [];

    for (const info of matchInfos) {
      const textBefore = line.substring(lastIndex, info.match.index);
      if (textBefore) segments.push(textBefore);
      lastIndex = (info.match.index ?? 0) + info.match[0].length;

      // Legacy behaviour: unrecognised {Field} on current node → preserve the raw token.
      if ((info.kind === 'current' || info.kind === 'current-keepalive') && !template.fields.find(f => f.name === info.fieldName)) {
        segments.push(info.match[0]);
        continue;
      }

      const resolved = resolveMatch(info);
      if (resolved !== undefined) segments.push(resolved);
      // Unresolved new-syntax placeholders are silently dropped (emit nothing).
    }

    const textAfter = line.substring(lastIndex);
    if (textAfter) segments.push(textAfter);

    const renderedLine = segments.join('');
    const parts = renderedLine.split(URL_REGEX).filter(Boolean);
    return (
      <React.Fragment key={lineIndex}>
        {renderParts(parts, uiContext, treeContext, handleJumpToNode)}
      </React.Fragment>
    );
  }).filter(Boolean);

  return (
    <div>
      {processedLines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}
