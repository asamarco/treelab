/**
 * @fileoverview
 * This is the main client-side component for the public tree view.
 * It sets up all the necessary providers and renders the main TreePage,
 * ensuring that UI state changes (like expanding nodes) are correctly handled.
 */
"use client";

import { AuthProvider } from "@/contexts/auth-context";
import { TreeProvider } from "@/contexts/tree-roots";
import { UIProvider } from "@/contexts/ui-context";
import { Toaster } from "@/components/ui/toaster";
import { TreePage } from "@/app/page-client";
import { PublicViewBanner } from "@/components/public-view-banner";
import { TreeFile } from "@/lib/types";
import { useEffect } from "react";

interface PublicTreeViewClientProps {
  initialTree: TreeFile;
  initialView?: string;
}

export function PublicTreeViewClient({ initialTree, initialView }: PublicTreeViewClientProps) {
  const isAuthRequired = true;
  const defaultUserId = "test";
  
  useEffect(() => {
    document.body.classList.add('read-only-view');
    return () => {
      document.body.classList.remove('read-only-view');
    }
  }, []);

  const initialCompact = initialView === 'compact';
  const initialTwoPanel = initialView === 'two-panel';

  return (
    <AuthProvider isAuthRequired={isAuthRequired} defaultUserId={defaultUserId}>
      <UIProvider 
        initialStandardView={true} 
        initialCompact={initialCompact} 
        initialTwoPanel={initialTwoPanel}
      >
        <TreeProvider initialTree={initialTree}>
          <PublicViewBanner />
          <TreePage />
          <Toaster />
        </TreeProvider>
      </UIProvider>
    </AuthProvider>
  );
}
