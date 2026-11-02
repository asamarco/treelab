"use client";

import { Check, Keyboard, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useNodeShortcuts } from "@/hooks/use-node-shortcuts";
import { useToast } from "@/hooks/use-toast";
import { useUIContext } from "@/contexts/ui-context";
import type { TreeNode } from "@/lib/types";

const EMPTY_SLOT_HINT = "Open a node's menu and choose Link → Assign shortcut.";

export function NodeShortcutSubMenu({ node }: { node: TreeNode }) {
  const { canUse, slotKeys, resolveSlot, assignSlot, clearNode, shortcuts } = useNodeShortcuts();

  if (!canUse) return null;

  const hasShortcut = shortcuts.some(shortcut => shortcut.nodeId === node.id);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Keyboard className="mr-2 h-4 w-4" />
        <span>Assign shortcut</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-64">
          {slotKeys.map(key => {
            const assigned = resolveSlot(key);
            const isThisNode = assigned?.id === node.id;
            return (
              <DropdownMenuItem key={key} onSelect={() => assignSlot(key, node.id)}>
                <kbd className="mr-2 rounded border bg-muted px-1.5 font-mono text-xs">{key}</kbd>
                <span className={assigned ? "flex-1 truncate max-w-[10rem]" : "flex-1 text-muted-foreground"}>
                  {assigned ? assigned.name : "Empty"}
                </span>
                {isThisNode && <Check className="ml-2 h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => clearNode(node.id)} disabled={!hasShortcut}>
            <X className="mr-2 h-4 w-4" /> Clear shortcut
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export function NodeShortcutsHeaderMenu() {
  const { canUse, slotKeys, resolveSlot, clearSlot } = useNodeShortcuts();
  const { setShortcutSlot } = useUIContext();
  const { toast } = useToast();

  if (!canUse) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Node shortcuts" title="Node shortcuts">
          <Keyboard className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Node shortcuts</DropdownMenuLabel>
        {slotKeys.map(key => {
          const assigned = resolveSlot(key);
          return (
            <DropdownMenuItem
              key={key}
              onSelect={() => {
                if (assigned) {
                  setShortcutSlot(key);
                } else {
                  toast({ title: `Slot ${key} is empty`, description: EMPTY_SLOT_HINT });
                }
              }}
            >
              <kbd className="mr-2 rounded border bg-muted px-1.5 font-mono text-xs">{key}</kbd>
              <span className={assigned ? "flex-1 truncate" : "flex-1 text-muted-foreground"}>
                {assigned ? assigned.name : "Empty"}
              </span>
              {assigned && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  aria-label={`Clear shortcut ${key}`}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSlot(key);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Press 0-9 to open a slot. {EMPTY_SLOT_HINT}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
