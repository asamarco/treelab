

/**
 * @fileoverview
 * This component, `RenderWithLinks`, is a utility for rendering text content
 * that may contain URLs. It parses the input text, identifies URLs that correspond
 * to 'link' fields in the node's data, and transforms them into clickable `<a>` tags.
 *
 * This allows for rich text display within tree nodes, automatically making
 * specified links interactive. Other text is rendered as-is.
 */
"use client";

import React, { useContext } from 'react';
import { TreeNode, Template } from '@/lib/types';
import { Link as LinkIcon } from 'lucide-react';
import { TreeContext } from '@/contexts/tree-context';
import { UIContext } from '@/contexts/ui-context';
import { Button } from '../ui/button';
import parseHtml from 'html-react-parser';
import { AuthContext } from '@/contexts/auth-context';
import { formatDate } from '@/lib/utils';


interface RenderWithLinksProps {
  node: TreeNode;
  template: Template;
  text: string;
}

// Regex to find standard URLs or our custom node:// links.
const URL_REGEX = /(https?:\/\/[^\s"'<>`]+)|(node:\/\/[\w.:-]+)/g;


export function RenderWithLinks({ node, template, text }: RenderWithLinksProps) {
  const uiContext = useContext(UIContext);
  const treeContext = useContext(TreeContext);
  const authContext = useContext(AuthContext);
  const currentUser = authContext?.currentUser;

  if (!text) return null;

  const handleNodeLinkClick = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    uiContext?.setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [nodeId] });
  };
  
  const nodeData = node.data || {};
  const placeholderRegex = /\{([^}]+)\}|\?\{([^}]+)\}/g;

  const lines = text.split('\n');
  const processedLines = lines.map((line, lineIndex) => {
    const placeholders = Array.from(line.matchAll(placeholderRegex));
    if (placeholders.length === 0) {
      const parts = line.split(URL_REGEX).filter(Boolean);
      return (
        <React.Fragment key={lineIndex}>
          {parts.map((part, index) => {
            if (part.startsWith('node://')) {
              const nodeId = part.substring(7);
              const linkedNodeInfo = treeContext?.findNodeAndParent(nodeId);
              const nodeName = linkedNodeInfo ? linkedNodeInfo.node.name : 'Invalid Link';
              // If context is not available (e.g., during static export), render as plain text.
              if (!uiContext || !treeContext) return <span key={index} className="font-semibold">{nodeName}</span>;
              return <Button key={index} variant="link" className="p-0 h-auto" onClick={(e) => handleNodeLinkClick(e, nodeId)}>{nodeName}</Button>;
            }
            if (part.match(/https?:\/\//)) {
              return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline">{part}</a>;
            }
            return parseHtml(part);
          })}
        </React.Fragment>
      );
    }
    
    // Logic for handling placeholders...
    let lastIndex = 0;
    const segments = [];
    
    for (const match of placeholders) {
      const isKeepAlive = match[0].startsWith('?{');
      const fieldName = (match[1] || match[2]).trim();
      const field = template.fields.find(f => f.name === fieldName);
      
      const textBefore = line.substring(lastIndex, match.index);
      if (textBefore) segments.push(textBefore);

      lastIndex = (match.index ?? 0) + match[0].length;
      
      if (!field || field.type === 'picture' || field.type === 'table-header' || field.type === 'attachment') {
        segments.push(match[0]);
        continue;
      }

      let value = nodeData[field.id];
      const valueIsEmpty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
      
      if (!isKeepAlive && valueIsEmpty) {
        // If it's a standard placeholder and it's empty, we might hide the whole line later
      }

      if (!valueIsEmpty) {
        let formattedValue = String(value);

        if (field.type === "date" && typeof value === 'string') {
          formattedValue = formatDate(value, currentUser?.dateFormat);
        }
        
        let finalValue = formattedValue;
        if (finalValue) {
          finalValue = `${field.prefix || ''}${finalValue}${field.postfix || ''}`;
        }
        segments.push(finalValue);
      }
    }
    
    const textAfter = line.substring(lastIndex);
    if (textAfter) segments.push(textAfter);

    const renderedLine = segments.join('');
    
    // Check if line should be rendered
     const hasContent = placeholders.some(match => {
        const fieldName = (match[1] || match[2]).trim();
        const field = template.fields.find(f => f.name === fieldName);
        if (!field) return true; // keep unmatched placeholders
        const value = nodeData[field.id];
        return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
      });
      
    if (!hasContent && !placeholders.some(m => m[0].startsWith('?{'))) return null;

    const parts = renderedLine.split(URL_REGEX).filter(Boolean);
    return (
      <React.Fragment key={lineIndex}>
        {parts.map((part, index) => {
          if (part.startsWith('node://')) {
            const nodeId = part.substring(7);
            const linkedNodeInfo = treeContext?.findNodeAndParent(nodeId);
            const nodeName = linkedNodeInfo ? linkedNodeInfo.node.name : 'Invalid Link';
            if (!uiContext || !treeContext) return <span key={index} className="font-semibold">{nodeName}</span>;
            return <Button key={index} variant="link" className="p-0 h-auto" onClick={(e) => handleNodeLinkClick(e, nodeId)}>{nodeName}</Button>;
          }
          if (part.match(/https?:\/\//)) {
            return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline">{part}</a>;
          }
          return parseHtml(part);
        })}
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
