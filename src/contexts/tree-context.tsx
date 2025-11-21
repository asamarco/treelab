/**
 * @fileoverview
 * Optimized Tree Context for managing tree data and actions.
 * Key improvements:
 * - Unified single/multi-node operations (delete, template changes).
 * - Extracted reusable tree traversal and ordering helpers.
 * - Batched DB writes where possible.
 * - Simplified optimistic updates with targeted mutations.
 */
"use client";

import React, { createContext, useContext, ReactNode } from "react";
import {
  TreeFile,
  TreeContextType,
} from '@/lib/types';
import { useTreeRoots } from "./tree-roots";

export const TreeContext = createContext<TreeContextType | undefined>(undefined);

interface TreeProviderProps {
  children: ReactNode;
  initialTree?: TreeFile;
}


/* --------------------------------- Provider -------------------------------- */

export function TreeProvider({ children, initialTree }: TreeProviderProps) {
  const treeRootsHook = useTreeRoots({initialTree});

  return <TreeContext.Provider value={treeRootsHook}>{children}</TreeContext.Provider>;
}

/* ---------------------------------- Hook ----------------------------------- */

export function useTreeContext() {
  const context = useContext(TreeContext);
  if (context === undefined) {
    throw new Error("useTreeContext must be used within a TreeProvider");
  }
  return context;
}