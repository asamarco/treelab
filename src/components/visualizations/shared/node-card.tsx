"use client";

import React, { useEffect, useRef } from "react";
import { Field, Template, TreeNode } from "@/lib/types";
import { Icon } from "@/components/icon";
import { getConditionalStyle } from "@/components/tree/tree-node-utils";
import { formatCellValue } from "@/components/tree/query-field/format-cell-value";
import { cn } from "@/lib/utils";

const OPEN_CLICK_DELAY_MS = 250;

interface NodeOpenHandlers {
  onOpen?: (nodeId: string) => void;
  onEdit?: (nodeId: string) => void;
}

/**
 * A single click opens the explorer after a short delay. A double click cancels that pending
 * open and opens the edit form instead, matching the Query table.
 */
export function useNodeOpenHandlers(nodeId: string, { onOpen, onEdit }: NodeOpenHandlers) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const cancelPendingOpen = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return {
    onTitleClick: () => {
      cancelPendingOpen();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onOpen?.(nodeId);
      }, OPEN_CLICK_DELAY_MS);
    },
    onDoubleClick: () => {
      cancelPendingOpen();
      onEdit?.(nodeId);
    },
  };
}

interface NodeTitleProps {
  node: TreeNode;
  template: Template | undefined;
  isCompact: boolean;
  onClick?: () => void;
  className?: string;
}

export function NodeTitle({ node, template, isCompact, onClick, className }: NodeTitleProps) {
  const { icon, color } = getConditionalStyle(node, template);
  return (
    <>
      <Icon name={icon as any} className="h-4 w-4 shrink-0" style={{ color }} />
      <button
        type="button"
        className={cn(
          "text-left font-medium truncate flex-1 min-w-0 hover:underline",
          isCompact ? "text-xs" : "text-sm",
          className,
        )}
        onClick={onClick}
      >
        {node.name}
      </button>
    </>
  );
}

export interface NodeCardField {
  id: string;
  name: string;
  value: string;
}

export function getNodeCardFields(node: TreeNode, fields: Field[], dateFormat?: string): NodeCardField[] {
  return fields.flatMap(field => {
    const value = formatCellValue(node, field, dateFormat);
    return value ? [{ id: field.id, name: field.name, value }] : [];
  });
}

export function NodeCardFieldLines({ fields, isCompact }: { fields: NodeCardField[]; isCompact: boolean }) {
  return (
    <>
      {fields.map(field => (
        <div key={field.id} className={cn("text-muted-foreground truncate", isCompact ? "text-[10px]" : "text-xs")}>
          <span className="font-medium">{field.name}:</span> {field.value}
        </div>
      ))}
    </>
  );
}
