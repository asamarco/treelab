/**
 * @fileoverview
 * This file defines the context for managing global UI state.
 * It handles state that affects the overall user interface but is not directly
 * tied to authentication or tree data, such as dialog visibility or view modes.
 */
"use client";

import React, { createContext, useContext, ReactNode, useState } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { TreeNode } from "@/lib/types";

export interface DialogState {
    isAddNodeOpen?: boolean;
    isRenameTreeOpen?: boolean;
    initialTreeTitle?: string;
    isCommitOpen?: boolean;
    isOutOfSyncCommitOpen?: boolean;
    isHistoryOpen?: boolean;
    exportNodes?: TreeNode[];
    exportTitle?: string;
    exportElementId?: string;
    isNodePreviewOpen?: boolean;
    nodeIdsForPreview?: string[];
    isChangeTemplateMultipleOpen?: boolean;
    isNodeEditOpen?: boolean;
    isAddChildOpen?: boolean;
    isAddSiblingOpen?: boolean;
    isChangeTemplateOpen?: boolean;
    isPasteTemplateOpen?: boolean;
    nodeInstanceIdForAction?: string;
}

interface UIContextType {
  isCompactView: boolean;
  setIsCompactView: (isCompact: boolean | ((prevState: boolean) => boolean)) => void;
  showNodeOrder: boolean;
  setShowNodeOrder: (show: boolean | ((prevState: boolean) => boolean)) => void;
  dialogState: Partial<DialogState>;
  setDialogState: (newState: Partial<DialogState>) => void;
  ignoreClicksUntil: number;
  setIgnoreClicksUntil: (timestamp: number) => void;
}

export const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [isCompactView, setIsCompactView] = useLocalStorage<boolean>('isCompactView', false);
  const [showNodeOrder, setShowNodeOrder] = useLocalStorage<boolean>('showNodeOrder', false);
  const [dialogState, setDialogStateInternal] = useState<Partial<DialogState>>({});
  const [ignoreClicksUntil, setIgnoreClicksUntil] = useState(0);
  
  const setDialogState = (newState: Partial<DialogState>) => {
    //console.log('[UIContext] Setting dialog state:', newState);
    setDialogStateInternal(prev => {
        const nextState = {...prev, ...newState};
        //console.log('[UIContext] Previous state:', prev);
        //console.log('[UIContext] Next state:', nextState);
        return nextState;
    });
  };

  const value: UIContextType = {
    isCompactView,
    setIsCompactView,
    showNodeOrder,
    setShowNodeOrder,
    dialogState,
    setDialogState,
    ignoreClicksUntil,
    setIgnoreClicksUntil,
  };

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUIContext() {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error("useUIContext must be used within an UIProvider");
  }
  return context;
}
