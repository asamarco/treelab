"use client";

/**
 * @fileoverview
 * Paragraph field plugin. Behaves like a textarea for data entry (multiline
 * plain text) but renders using `RenderWithLinks` in the tree viewer, so the
 * stored text is processed for:
 *  - `{field name}` / `?{field name}` replaced with the node field values.
 *  - `https://...` URLs rendered as clickable anchor tags.
 *  - `node://...` internal links rendered as jump-to-node buttons.
 */

import React, { useContext } from 'react';
import { Pilcrow } from 'lucide-react';
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { Textarea } from '@/components/ui/textarea';
import { Field, TreeNode } from '@/lib/types';
import { RenderWithLinks } from '@/components/tree/render-with-links';
import { TreeContext } from '@/contexts/tree-context';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const ParagraphEditorComponent = React.memo(
  ({
    field,
    value,
    onChange,
  }: {
    field: Field;
    value: any;
    onChange: (val: any) => void;
  }) => {
    return (
      <Textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${field.name}...`}
        className="min-h-[120px] resize-y"
      />
    );
  }
);
ParagraphEditorComponent.displayName = 'ParagraphEditorComponent';

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

const ParagraphViewerComponent = ({
  field,
  value,
  node,
  isCompactView,
}: {
  field: Field;
  value: any;
  node?: TreeNode;
  readOnly?: boolean;
  isCompactView?: boolean;
}) => {
  const treeContext = useContext(TreeContext);

  if (!value || (typeof value === 'string' && value.trim() === '')) return null;
  if (!node) return null;

  const template = treeContext?.getTemplateById(node.templateId);
  if (!template) return null;

  return (
    <div
      className="mt-2"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <p className={cn('font-medium mb-1', isCompactView ? 'text-xs' : 'text-sm')}>
        {field.name}
      </p>
      <div
        className={cn(
          'text-foreground/90 whitespace-pre-wrap',
          isCompactView ? 'text-xs' : 'text-sm'
        )}
      >
        <RenderWithLinks node={node} template={template} text={String(value)} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const ParagraphPlugin: FieldTypePlugin = {
  type: 'paragraph',
  label: 'Paragraph',
  icon: Pilcrow,
  EditorComponent: ParagraphEditorComponent,
  ViewerComponent: ParagraphViewerComponent,
  isEmpty: (value: any) =>
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === ''),
};