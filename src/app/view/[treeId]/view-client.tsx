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

interface PublicTreeViewClientProps {
  initialTree: TreeFile;
}

export function PublicTreeViewClient({ initialTree }: PublicTreeViewClientProps) {
  // Hardcoded config for public view as we can't read files on the client
  const isAuthRequired = true;
  const defaultUserId = "test";

  return (
    <AuthProvider isAuthRequired={isAuthRequired} defaultUserId={defaultUserId}>
      <UIProvider>
        <TreeProvider initialTree={initialTree}>
          <PublicViewBanner />
          <TreePage />
          <Toaster />
        </TreeProvider>
      </UIProvider>
    </AuthProvider>
  );
}
