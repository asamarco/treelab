import { TreeNode, Template } from './types';
import { formatDate } from './utils';

// Regex matching placeholders (same as original RenderWithLinks)
const PLACEHOLDER_REGEX =
  /\{count(?::(\d+))?\}|\{parent:([^}]+)\}|\{ancestor:([^}:]+):(\d+)\}|\{child:([^}]+)\}|\{([^}]+)\}|\?\{([^}]+)\}/g;

type MatchKind = 'count' | 'parent' | 'ancestor' | 'child' | 'current' | 'current-keepalive';

interface MatchInfo {
  match: RegExpMatchArray;
  kind: MatchKind;
  fieldName?: string;
  depth?: number;
}

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

/**
 * Helper to escape markdown-significant characters in resolved placeholder values.
 */
function escapeMarkdown(val: string): string {
  // * _ ` [ ] ( ) # + - . ! and backslash, backslash first
  return val.replace(/\\/g, '\\\\').replace(/[*_`\[\]()#+\-.!]/g, '\\$&');
}

export interface ResolveTemplateTextOptions {
  escapeForMarkdown?: boolean;
  findNodeAndParent?: (nodeId: string) => { node: TreeNode; parent: TreeNode | null } | null;
}

/**
 * Pure function to resolve placeholder syntax in template strings.
 * Returns an array of resolved string lines, matching existing per-line suppression semantics.
 */
export function resolveTemplateText(
  text: string,
  node: TreeNode,
  template: Template,
  allTemplates: Template[],
  ancestorChain: TreeNode[],
  dateFormat: string | undefined,
  options?: ResolveTemplateTextOptions
): string[] {
  if (!text) return [];

  const nodeData = node.data || {};
  const lines = text.split('\n');
  const resultLines: string[] = [];

  for (const line of lines) {
    const placeholders = Array.from(line.matchAll(PLACEHOLDER_REGEX));

    if (placeholders.length === 0) {
      resultLines.push(line);
      continue;
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

    const hasAnyKeepAlive = matchInfos.some(i => i.kind === 'current-keepalive');

    const hasAnyValue = matchInfos.some(i => {
      if (i.kind === 'count') return true;
      if (i.kind === 'current' || i.kind === 'current-keepalive') {
        const field = template.fields.find(f => f.name === i.fieldName);
        if (!field) return true;
      }
      return resolveMatch(i) !== undefined;
    });

    if (!hasAnyValue && !hasAnyKeepAlive) continue;

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
      if (resolved !== undefined) {
        if (options?.escapeForMarkdown) {
          // EXPLICIT SCOPE BOUNDARY: This converts node:// values that arrive as a single, whole resolved
          // placeholder value (e.g. a link-type field's entire value). It does NOT replicate RenderWithLinks'
          // whole-line URL_REGEX scan (which can also catch a literal node:// or https:// substring typed directly
          // into surrounding template text, independent of any placeholder). Reproducing that for markdown would
          // mean re-splicing link syntax into an already-assembled string after the fact, which is fragile —
          // deliberately out of scope. Markdown fields get clickable node links only via a placeholder whose
          // resolved value IS a node:// URL, not from literal node:// text typed into the markdown source.
          if (/^node:\/\/[\w.:-]+$/.test(resolved)) {
            const nodeId = resolved.substring(7);
            const linkedNodeInfo = options.findNodeAndParent?.(nodeId);
            const nodeName = linkedNodeInfo ? linkedNodeInfo.node.name : 'Invalid Link';
            const escapedName = nodeName.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
            segments.push(`[${escapedName}](${resolved})`);
          } else {
            segments.push(escapeMarkdown(resolved));
          }
        } else {
          segments.push(resolved);
        }
      }
    }

    const textAfter = line.substring(lastIndex);
    if (textAfter) segments.push(textAfter);

    resultLines.push(segments.join(''));
  }

  return resultLines;
}
