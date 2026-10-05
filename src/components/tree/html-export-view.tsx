/**
 * @fileoverview
 * This component, `HtmlExportView`, is used exclusively for generating a static
 * HTML representation of a tree for export. It is not part of the interactive UI.
 * It recursively renders all nodes in a nested structure, ensuring the entire
 * tree is included in the final HTML output.
 */
import React from 'react';
import { TreeNode, Template, AttachmentInfo, User } from '@/lib/types';
import { RenderWithLinks } from './render-with-links';
import { getConditionalStyle } from './tree-node-utils';
import { FieldRegistry, isValueEmpty } from '@/lib/field-types';

interface HtmlExportViewProps {
  nodes: TreeNode[];
  title: string;
  getTemplateById: (id: string) => Template | undefined;
  imageMap: Map<string, string>; // Maps server path to Base64 data URI
  attachmentsMap: Map<string, string>; // Maps server path to original file name
  currentUser: User | null; // Pass user data as a prop
}

interface HtmlNodeProps {
  node: TreeNode;
  level: number;
  getTemplateById: (id: string) => Template | undefined;
  imageMap: Map<string, string>;
  attachmentsMap: Map<string, string>;
  currentUser: User | null;
  ancestorChain?: TreeNode[];
}

const HtmlNode: React.FC<HtmlNodeProps> = ({ node, level, getTemplateById, imageMap, attachmentsMap, currentUser, ancestorChain = [] }) => {
  const template = getTemplateById(node.templateId);
  if (!template) {
    return <div style={{ paddingLeft: `${level * 24}px` }}>Template not found for this node.</div>;
  }

  const { color } = getConditionalStyle(node, template);

  const tableHeaderFields = template.fields.filter(f => f.type === 'table-header').filter(field => {
    const columnData = (node.data || {})[field.id];
    return Array.isArray(columnData) && columnData.some(val => val !== null && val !== undefined && val !== '');
  });

  const getTableRowCount = () => {
    if (tableHeaderFields.length === 0) return 0;
    const firstColumnData = (node.data || {})[tableHeaderFields[0].id];
    return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
  };

  const tableRowCount = getTableRowCount();
  const hasChildren = node.children && node.children.length > 0;

  const renderContent = () => (
    <div className="tree-node-content">
      {template.fields.filter(f => f.type !== 'table-header').map(field => {
        const value = (node.data || {})[field.id];
        const plugin = FieldRegistry.get(field.type);

        const empty = plugin?.isEmpty ? plugin.isEmpty(value, field) : isValueEmpty(value, field);
        if (empty) return null;

        // Dedicated static fallback for spreadsheet:
        // jspreadsheet-ce (used by live SpreadsheetViewerComponent) relies on imperative client-side
        // DOM initialization in useEffect, rendering an empty container during static SSR markup generation.
        if (field.type === 'spreadsheet') {
          const gridData: any[][] = Array.isArray(value) ? value : [];
          return (
            <div key={field.id} style={{ marginTop: '8px', overflowX: 'auto' }}>
              <p style={{ fontWeight: 500, marginBottom: '4px' }}>{field.name}</p>
              <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
                <tbody>
                  {gridData.map((row, rIdx) => (
                    <tr key={rIdx} style={{ borderBottom: '1px solid #ddd' }}>
                      {(Array.isArray(row) ? row : []).map((cell: any, cIdx: number) => {
                        const cellVal = cell?.value !== undefined ? cell.value : (typeof cell === 'string' ? cell : '');
                        return (
                          <td key={cIdx} style={{ border: '1px solid #ddd', padding: '8px' }}>
                            {cellVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // Dedicated static fallback for picture:
        // Live PictureViewerComponent uses client-side ResizeObserver, Embla carousel JS, and raw server URLs (/attachments/...).
        // For standalone static HTML export, we use pre-converted Base64 data URIs from imageMap and render clean static <img> tags.
        if (field.type === 'picture') {
          const images = (Array.isArray(value) ? value : [value]).filter(Boolean);
          if (images.length === 0) return null;
          return (
            <div key={field.id} style={{ marginTop: '8px' }}>
              <p style={{ fontWeight: 500, marginBottom: '4px' }}>{field.name}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {images.map((src, index) => {
                  const dataUri = imageMap.get(src) || src;
                  return <img key={index} src={dataUri} alt={field.name} style={{ maxWidth: '200px', height: 'auto', borderRadius: '4px' }} />;
                })}
              </div>
            </div>
          );
        }

        // Default: Reuse live ViewerComponent from FieldRegistry for all other field types
        // (markdown, checklist, embed, xy-chart, attachment, and future field plugins).
        if (plugin?.ViewerComponent) {
          const ViewerComponent = plugin.ViewerComponent;
          return (
            <div key={field.id}>
              <ViewerComponent
                field={field}
                value={value}
                node={node}
                readOnly={true}
                isCompactView={false}
                isStatic={true}
                ancestorChain={ancestorChain}
              />
            </div>
          );
        }

        return null;
      })}

      {tableHeaderFields.length > 0 && tableRowCount > 0 && (
        <div style={{ marginTop: '8px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
            <thead>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                {tableHeaderFields.map(field => (
                  <th key={field.id} style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left' }}>{field.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: tableRowCount }).map((_, rowIndex) => (
                <tr key={rowIndex} style={{ borderBottom: '1px solid #ddd' }}>
                  {tableHeaderFields.map(field => {
                    const cellValue = (node.data || {})[field.id]?.[rowIndex] || '';
                    const displayValue = cellValue ? `${field.prefix || ''}${cellValue}${field.postfix || ''}` : '';
                    return (
                      <td key={field.id} style={{ border: '1px solid #ddd', padding: '8px' }}>{displayValue}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {template.bodyTemplate && (
        <div style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>
          <RenderWithLinks node={node} template={template} text={template.bodyTemplate} ancestorChain={ancestorChain} />
        </div>
      )}

      {hasChildren && (
        <div className="children-container" style={{ marginTop: '8px' }}>
          {node.children!.map(child => (
            <HtmlNode key={child.id} node={child} level={level + 1} getTemplateById={getTemplateById} imageMap={imageMap} attachmentsMap={attachmentsMap} currentUser={currentUser} ancestorChain={[...ancestorChain, node]} />
          ))}
        </div>
      )}
    </div>
  );

  const renderedName = (
    <RenderWithLinks node={node} template={template} text={template.nameTemplate || node.name} ancestorChain={ancestorChain} />
  );

  if (hasChildren) {
    return (
      <div className="tree-node-card-wrapper" style={{ marginLeft: `${level * 24}px` }}>
        <details className="tree-node-details">
          <summary className="tree-node-summary" style={{ borderLeft: `3px solid ${color || '#ccc'}` }}>
            <h3 style={{ color: color || 'inherit', margin: 0, display: 'inline', fontSize: `${Math.max(1.5 - level * 0.1, 0.8)}rem` }}>
              {renderedName}
            </h3>
          </summary>
          <div className="tree-node-card" style={{ borderLeft: `3px solid ${color || '#ccc'}` }}>
            {renderContent()}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="tree-node-card" style={{ marginLeft: `${level * 24}px`, borderLeft: `3px solid ${color || '#ccc'}` }}>
      <div className="tree-node-header">
        <h3 style={{ color: color || 'inherit', margin: 0, fontSize: `${Math.max(1.5 - level * 0.1, 0.8)}rem` }}>
          {renderedName}
        </h3>
      </div>
      {renderContent()}
    </div>
  );
};


export const HtmlExportView: React.FC<HtmlExportViewProps> = ({ nodes, title, getTemplateById, imageMap, attachmentsMap, currentUser }) => {
  return (
    <div>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem' }}>{title}</h1>
      {nodes.map(rootNode => (
        <HtmlNode key={rootNode.id} node={rootNode} level={0} getTemplateById={getTemplateById} imageMap={imageMap} attachmentsMap={attachmentsMap} currentUser={currentUser} />
      ))}
    </div>
  );
};
