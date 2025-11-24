/**
 * @fileoverview
 * This file defines the context for managing all tree-related state.
 * It is responsible for creating the context and exporting the consumer hook.
 * The core logic and provider component are located in `tree-roots.tsx`.
 */
"use client";

import React, { createContext, useContext } from "react";
import { TreeContextType } from '@/lib/types';


/* --------------------------------- Context --------------------------------- */

export const TreeContext = createContext<TreeContextType | undefined>(undefined);


/* ---------------------------------- Hook ----------------------------------- */

export function useTreeContext() {
  const context = useContext(TreeContext);
  if (context === undefined) {
    throw new Error("useTreeContext must be used within a TreeProvider");
  }
  return context;
}
