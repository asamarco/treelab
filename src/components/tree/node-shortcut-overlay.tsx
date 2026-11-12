"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { icons, Eye, X } from "lucide-react";
import { TreeView } from "@/components/tree/tree-view";
import { RenderWithLinks } from "@/components/tree/render-with-links";
import { getConditionalStyle } from "@/components/tree/tree-node-utils";
import { computeExpandedIds } from "@/lib/tree-expansion";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import type { ShortcutKey } from "@/lib/node-shortcuts";
import type { TreeNode } from "@/lib/types";

interface NodeShortcutOverlayProps {
  slotKey: ShortcutKey;
  node: TreeNode;
  onClose: () => void;
}

export function NodeShortcutOverlay({ slotKey, node, onClose }: NodeShortcutOverlayProps) {
  const { currentUser } = useAuthContext();
  const { getTemplateById } = useTreeContext();
  const { setDialogState } = useUIContext();

  const template = getTemplateById(node.templateId);
  const { icon, color } = getConditionalStyle(node, template);
  const expansionDepth = currentUser?.twoPanelExpansionDepth ?? 1;

  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  useEffect(() => {
    setExpandedIds(computeExpandedIds([{ node, contextualParentId: null }], expansionDepth));
    // Re-seed only when a different node is shown, so edits to the node do not reset expansion.
  }, [node.id, expansionDepth]);

  return createPortal(
    <section
      aria-label={`Shortcut ${slotKey}: ${node.name}`}
      className="node-shortcut-overlay fixed inset-x-0 bottom-0 top-16 z-30 flex flex-col bg-background border-t shadow-xl"
    >
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b shrink-0">
        <Icon
          name={(icon as keyof typeof icons) || "FileText"}
          className="h-5 w-5 shrink-0"
          style={{ color: color || "hsl(var(--primary))" }}
        />
        <div className="flex-1 min-w-0 font-semibold truncate">
          {template ? (
            <RenderWithLinks
              node={node}
              template={template}
              text={template.nameTemplate ? template.nameTemplate : node.name}
              ancestorChain={[]}
            />
          ) : (
            node.name
          )}
        </div>
        <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{slotKey}</kbd>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label="Open in Explorer"
          onClick={() => setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [node.id] })}
        >
          <Eye className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Open in Explorer</span>
        </Button>
        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label="Close node shortcut" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 sm:p-6">
          <TreeView
            nodes={[node]}
            overrideExpandedIds={expandedIds}
            onExpandedChange={(updater) => setExpandedIds(updater as any)}
            disableSelection={true}
          />
        </div>
      </ScrollArea>
    </section>,
    document.body,
  );
}
