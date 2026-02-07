/**
 * @fileoverview
 * This file defines the context for managing global UI state.
 * It handles state that affects the overall user interface but is not directly
 * tied to authentication or tree data, such as dialog visibility or view modes.
 */
"use client";

import React, { createContext, useContext, ReactNode, useState, useEffect } from "react";
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
    isMultiNodeEditOpen?: boolean;
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
  isTwoPanelMode: boolean;
  setIsTwoPanelMode: (isTwoPanel: boolean | ((prevState: boolean) => boolean)) => void;
  showNodeOrder: boolean;
  setShowNodeOrder: (show: boolean | ((prevState: boolean) => boolean)) => void;
  dialogState: Partial<DialogState>;
  setDialogState: (newState: Partial<DialogState>) => void;
  ignoreClicksUntil: number;
  setIgnoreClicksUntil: (timestamp: number) => void;
}

export const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ 
  children, 
  initialStandardView = false,
  initialCompact = false,
  initialTwoPanel = false
}: { 
  children: React.ReactNode, 
  initialStandardView?: boolean,
  initialCompact?: boolean,
  initialTwoPanel?: boolean
}) {
  const [isCompactViewPersistent, setIsCompactViewPersistent] = useLocalStorage<boolean>('isCompactView', false);
  const [isTwoPanelModePersistent, setIsTwoPanelModePersistent] = useLocalStorage<boolean>('isTwoPanelMode', false);
  const [showNodeOrderPersistent, setShowNodeOrderPersistent] = useLocalStorage<boolean>('showNodeOrder', false);

  const [isCompactViewLocal, setIsCompactViewLocal] = useState(initialCompact);
  const [isTwoPanelModeLocal, setIsTwoPanelModeLocal] = useState(initialTwoPanel);
  const [showNodeOrderLocal, setShowNodeOrderLocal] = useState(false);

  const [dialogState, setDialogStateInternal] = useState<Partial<DialogState>>({});
  const [ignoreClicksUntil, setIgnoreClicksUntil] = useState(0);
  
  // Use non-persistent state if initialStandardView is true (e.g. for consistent first impression on public pages)
  const isCompactView = initialStandardView ? isCompactViewLocal : isCompactViewPersistent;
  const setIsCompactView = initialStandardView ? setIsCompactViewLocal : setIsCompactViewPersistent;
  
  const isTwoPanelMode = initialStandardView ? isTwoPanelModeLocal : isTwoPanelModePersistent;
  const setIsTwoPanelMode = initialStandardView ? setIsTwoPanelModeLocal : setIsTwoPanelModePersistent;

  const showNodeOrder = initialStandardView ? showNodeOrderLocal : showNodeOrderPersistent;
  const setShowNodeOrder = initialStandardView ? setShowNodeOrderLocal : setShowNodeOrderPersistent;

  const setDialogState = (newState: Partial<DialogState>) => {
    setDialogStateInternal(prev => {
        const nextState = {...prev, ...newState};
        return nextState;
    });
  };

  const value: UIContextType = {
    isCompactView,
    setIsCompactView,
    isTwoPanelMode,
    setIsTwoPanelMode,
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
