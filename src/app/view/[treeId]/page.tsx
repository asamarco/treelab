/**
 * @fileoverview
 * This file defines the public, read-only view page for a shared tree.
 * It fetches the public tree data on the server and renders the client-side
 * wrapper which handles the interactive UI.
 */
import { loadPublicTreeFile } from "@/lib/data-service";
import { PublicTreeViewClient } from "./view-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileQuestion } from "lucide-react";
import { Metadata } from "next";

type PageProps = {
  params: Promise<{
    treeId: string;
  }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { treeId } = await params;
  const tree = await loadPublicTreeFile(treeId);
  return {
    title: tree ? `${tree.title} - Treelab` : "Tree Not Found",
  };
}

export default async function PublicTreeViewPage({
  params,
  searchParams,
}: PageProps) {
  const { treeId } = await params;
  const { view } = await searchParams;
  const tree = await loadPublicTreeFile(treeId);

  if (!tree) {
    return (
      <div className="flex items-center justify-center h-screen bg-muted/20">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileQuestion className="h-6 w-6" />
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

  // The client component handles all providers and state
  return <PublicTreeViewClient 
    initialTree={JSON.parse(JSON.stringify(tree))} 
    initialView={typeof view === 'string' ? view : undefined}
  />;
}
