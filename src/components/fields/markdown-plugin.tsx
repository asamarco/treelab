"use client";

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { Textarea } from '@/components/ui/textarea';
import { Field, TreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const MarkdownEditorComponent = React.memo(
  ({
    field,
    value,
    onChange,
    readOnly,
  }: {
    field: Field;
    value: any;
    onChange: (val: any) => void;
    readOnly?: boolean;
  }) => {
    return (
      <Textarea
        rows={6}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${field.name}...`}
        disabled={readOnly}
        className="min-h-[140px] resize-y font-mono text-sm"
      />
    );
  }
);
MarkdownEditorComponent.displayName = 'MarkdownEditorComponent';

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

const MarkdownViewerComponent = ({
  field,
  value,
  isCompactView,
}: {
  field: Field;
  value: any;
  node?: TreeNode;
  readOnly?: boolean;
  isCompactView?: boolean;
}) => {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return null;
  }

  return (
    <div
      className="mt-2"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          'text-foreground/90 break-words',
          isCompactView ? 'text-xs' : 'text-sm'
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="text-lg font-bold mt-2 mb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-base font-semibold mt-2 mb-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-semibold mt-1.5 mb-0.5">{children}</h3>,
            h4: ({ children }) => <h4 className="text-sm font-medium mt-1 mb-0.5">{children}</h4>,
            p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:text-primary/80 break-words"
                onClick={(e) => e.stopPropagation()}
              >
                {children}
              </a>
            ),
            ul: ({ children }) => <ul className="list-disc pl-5 mb-1.5 space-y-0.5">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-5 mb-1.5 space-y-0.5">{children}</ol>,
            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground my-1.5">
                {children}
              </blockquote>
            ),
            code: ({ className, children }) => (
              <code className={cn('bg-muted px-1 py-0.5 rounded text-[0.85em] font-mono', className)}>
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="bg-muted p-2 rounded-md overflow-x-auto text-[0.85em] font-mono my-1.5">
                {children}
              </pre>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto my-1.5">
                <table className="min-w-full divide-y divide-border border border-border text-xs">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-border bg-muted/50 px-2 py-1 text-left font-medium">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-2 py-1">
                {children}
              </td>
            ),
            hr: () => <hr className="my-2 border-border" />,
          }}
        >
          {String(value)}
        </ReactMarkdown>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const MarkdownPlugin: FieldTypePlugin = {
  type: 'markdown',
  label: 'Markdown',
  icon: FileText,
  EditorComponent: MarkdownEditorComponent,
  ViewerComponent: MarkdownViewerComponent,
  isEmpty: (value: any) =>
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === ''),
};
