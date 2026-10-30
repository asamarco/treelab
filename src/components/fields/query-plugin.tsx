"use client";

import { Search } from 'lucide-react';
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { QueryBuilder } from '@/components/tree/query-field/query-builder';
import { QueryFieldView } from '@/components/tree/query-field';

export const QueryPlugin: FieldTypePlugin = {
  type: "query",
  label: "Query",
  icon: Search,
  EditorComponent: ({ field, value, onChange }) => (
    <QueryBuilder field={field} value={value} onChange={onChange} />
  ),
  ViewerComponent: ({ field, node, isCompactView }) => {
    if (!node) return null;
    return <QueryFieldView field={field} node={node} isCompactView={!!isCompactView} />;
  },
  // Query bodies stay visible in the node header even when empty
  isEmpty: () => false,
  excludeFromStaticExport: true,
};
