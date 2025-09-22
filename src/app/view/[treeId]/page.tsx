

/**
 * @fileoverview
 * This file defines the public, read-only view page for a shared tree.
 * It fetches the public tree data on the server and renders the tree using
 * the standard `TreeView` component but disables interaction.
 */
import { loadPublicTreeFile } from "@/lib/data-service";
import { TreeView } from "@/components/tree/tree-view";
import { AppHeader } from "@/components/header";
import { AuthProvider } from "@/contexts/auth-context";
import { TreeProvider } from "@/contexts/tree-context";
import { UIProvider } from "@/contexts/ui-context";
import { Toaster } from "@/components/ui/toaster";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FileQuestion, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import fs from 'fs';
import path from 'path';
import { Metadata } from "next";
import { PublicViewWrapper } from "@/components/public-view-wrapper";


interface AppConfig {
    REQUIRE_AUTHENTICATION?: boolean;
    USERID?: string;
}

interface PublicTreePageProps {
  params: {
    treeId: string;
  };
}

type Params = Promise<{ treeId: string }>

export async function generateMetadata(
  { params }: { params: Params }
): Promise<Metadata> {
  const { treeId } = await params
  const tree = await loadPublicTreeFile(treeId)
  return {
    title: tree ? `${tree.title} - Treelab` : "Tree Not Found",
  }
}

export default async function PublicTreeViewPage(
  { params }: { params: Params }
) {
  const { treeId } = await params
  const tree = await loadPublicTreeFile(treeId)

  // Read configuration from config.json
  const configPath = path.join(process.cwd(), 'config.json');
  let appConfig: AppConfig = {};
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    appConfig = JSON.parse(configFile);
  } catch (error) {
    console.error("Could not read or parse config.json, using defaults.", error);
  }
  
  const isAuthRequired = appConfig.REQUIRE_AUTHENTICATION ?? true;
  const defaultUserId = appConfig.USERID || "test";

  if (!tree) {
    return (
      <div className="flex items-center justify-center h-screen bg-muted/20">
        <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileQuestion className="h-6 w-6"/>
                    Tree Not Found
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p>This tree could not be found or has not been made public.</p>
            </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="read-only-view">
      <AuthProvider isAuthRequired={isAuthRequired} defaultUserId={defaultUserId}>
        <UIProvider>
        <TreeProvider initialTree={JSON.parse(JSON.stringify(tree))}>
          <PublicViewWrapper tree={tree}>
            <div className="flex flex-col min-h-screen bg-background">
              <AppHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4 md:py-8">
                  <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4">
                      <div className="flex items-center gap-4">
                          <h1 className="text-3xl font-bold">{tree.title}</h1>
                          <Badge variant="outline" className="flex items-center gap-2">
                          <Eye className="h-4 w-4" />
                          Read-only view
                          </Badge>
                      </div>
                  </div>
                  <TreeView nodes={tree.tree} />
              </main>
            </div>
          </PublicViewWrapper>
        </TreeProvider>
        </UIProvider>
      </AuthProvider>
    </div>
  );
}

