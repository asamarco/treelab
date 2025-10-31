

/**
 * @fileoverview
 * This file defines the Templates page, which is a protected route. It allows users
 * to manage the templates for the currently active tree.
 *
 * It features a two-column layout:
 * - The left column lists all existing templates, with options to create new ones,
 *   filter, sort, delete, import, and export all templates.
 * - The right column displays the `TemplateDesigner` component, allowing users to
 *   create a new template or edit a selected one.
 */
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from 'next/navigation';
import { Template, TreeNode } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";
import { TemplateDesigner } from "@/components/template/template-designer";
import { AppHeader } from "@/components/header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Trash2, Edit, Search, Download, Upload, FileJson, GripVertical, Archive } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/icon";
import { icons } from "lucide-react";
import { ProtectedRoute } from "@/components/protected-route";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateJsonForExport } from "@/lib/utils";


function DraggableTemplateWrapper({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 100 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
      <div className="flex flex-col items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="cursor-grab shrink-0 h-8 w-8"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </Button>
      </div>
      <div className="w-full">{children}</div>
    </div>
  );
}


function TemplatesPage() {
  const router = useRouter();
  const { 
    activeTree, 
    templates, 
    setTemplates, 
    getTemplateById, 
    tree, 
    importTemplates,
    updateNodeNamesForTemplate
  } = useTreeContext();
  const [selectedTemplate, setSelectedTemplate] = useState<Partial<Template> | null>(null);
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!activeTree) {
        router.replace('/roots');
    }
  }, [activeTree, router]);

  const countTemplateUsage = useCallback((templateId: string): number => {
    let count = 0;
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.templateId === templateId) {
          count++;
        }
        if (node.children) {
          traverse(node.children);
        }
      }
    };
    traverse(tree);
    return count;
  }, [tree]);

  const templateUsage = useMemo(() => {
    const usageMap = new Map<string, number>();
    templates.forEach(t => {
      usageMap.set(t.id, countTemplateUsage(t.id));
    });
    return usageMap;
  }, [templates, countTemplateUsage]);

  const filteredTemplates = useMemo(() => {
    return templates
      .filter(template => 
        template.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
  }, [templates, searchTerm]);
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
       setTemplates((currentTemplates) => {
          const oldIndex = currentTemplates.findIndex((t) => t.id === active.id);
          const newIndex = currentTemplates.findIndex((t) => t.id === over.id);
          if (oldIndex !== -1 && newIndex !== -1) {
            return arrayMove(currentTemplates, oldIndex, newIndex);
          }
          return currentTemplates;
       });
    }
  };


  useEffect(() => {
    const templateIdToEdit = searchParams.get('edit');
    if (templateIdToEdit) {
      const template = getTemplateById(templateIdToEdit);
      if (template) {
        setSelectedTemplate(template);
      }
    }
  }, [searchParams, getTemplateById]);

  const handleSaveTemplate = (updatedTemplate: Template) => {
    const oldTemplate = getTemplateById(updatedTemplate.id);
    const nameTemplateChanged = oldTemplate && oldTemplate.nameTemplate !== updatedTemplate.nameTemplate;

    const exists = templates.some((t) => t.id === updatedTemplate.id);
    if (exists) {
      setTemplates((draft) => 
        draft.map((t) => (t.id === updatedTemplate.id ? updatedTemplate : t))
      );
    } else {
      setTemplates((draft) => {
        draft.push(updatedTemplate);
        return draft;
      });
    }

    // IMPORTANT: This block is critical for data consistency.
    // It checks if the node naming rule has changed. If it has, it iterates
    // through the entire tree and updates the names of all nodes that use this
    // template to reflect the new format. Do not remove this functionality.
    if (nameTemplateChanged) {
      updateNodeNamesForTemplate(updatedTemplate);
      toast({
        title: "Node Names Updated",
        description: `All nodes using the "${updatedTemplate.name}" template have been updated.`
      });
    }

    setSelectedTemplate(null);
  };
  
  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template);
  }
  
  const handleCreateNew = () => {
    const newFieldId = new Date().toISOString() + Math.random();
    setSelectedTemplate({
      id: `new_${new Date().toISOString()}`,
      name: "",
      fields: [{ id: newFieldId, name: "Name", type: "text" }],
      nameTemplate: "{Name}",
      bodyTemplate: "",
      icon: "FileText",
      color: "#64748b",
      conditionalRules: [],
    });
  }

  const handleDeleteTemplate = (templateId: string) => {
    setTemplates(draft => draft.filter(t => t.id !== templateId));
    if(selectedTemplate?.id === templateId) {
      setSelectedTemplate(null);
    }
  }

  const handleExportAll = async () => {
    if (!activeTree || templates.length === 0) return;

    const zip = new JSZip();
    const templatesFolder = zip.folder("templates");
    if (!templatesFolder) return;

    const order = templates.map(t => t.id);
    zip.file("order.json", JSON.stringify(order, null, 2));

    templates.forEach(template => {
        const filename = `${template.name.replace(/[\\?%*:|"<>]/g, '_')}.json`;
        templatesFolder.file(filename, JSON.stringify(template, null, 2));
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const filename = `${activeTree.title.toLowerCase().replace(/\s/g, '-')}-templates.zip`;
    saveAs(zipBlob, filename);

    toast({
        title: "Templates Archived",
        description: `${templates.length} templates have been saved to ${filename}.`
    });
  };
  
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.zip')) {
        try {
            const zip = await JSZip.loadAsync(file);
            const orderFile = zip.file("order.json");
            let templateOrder: string[] = [];

            if (orderFile) {
                const orderContent = await orderFile.async("string");
                templateOrder = JSON.parse(orderContent);
            }

            const templatesFolder = zip.folder("templates");
            const newTemplates: Template[] = [];

            if (templatesFolder) {
                const templateFiles: Promise<Template>[] = [];
                templatesFolder.forEach((relativePath, fileEntry) => {
                    if (fileEntry.name.endsWith(".json")) {
                        const promise = fileEntry.async("string").then(content => JSON.parse(content));
                        templateFiles.push(promise);
                    }
                });

                const importedTemplates = await Promise.all(templateFiles);
                
                // Sort imported templates based on order.json if it exists
                if (templateOrder.length > 0) {
                    const templateMap = new Map(importedTemplates.map(t => [t.id, t]));
                    templateOrder.forEach(id => {
                        const template = templateMap.get(id);
                        if (template) newTemplates.push(template);
                    });
                     // Add any templates not in order.json to the end
                    importedTemplates.forEach(t => {
                        if (!templateOrder.includes(t.id)) newTemplates.push(t);
                    });
                } else {
                    newTemplates.push(...importedTemplates);
                }
            }

            if (newTemplates.length > 0) {
                importTemplates(newTemplates);
                toast({
                    title: "Templates Imported",
                    description: `Successfully imported ${newTemplates.length} templates from the archive.`
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Import Failed",
                    description: "No templates found in the 'templates' folder of the archive.",
                });
            }
        } catch (err) {
            const description = err instanceof Error ? err.message : "Could not read or parse the archive.";
            toast({
                variant: "destructive",
                title: "Import Failed",
                description,
            });
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    } else {
        toast({
            variant: "destructive",
            title: "Invalid File",
            description: "Please select a .zip archive file."
        })
    }
  };


  if (!activeTree) {
     return (
        <ProtectedRoute>
            <div className="flex flex-col min-h-screen bg-muted/20">
                <AppHeader />
                <main className="flex-1 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
                    <Card>
                        <CardContent className="p-6 text-center">
                            <h2 className="text-xl font-semibold mb-2">No Active Tree</h2>
                            <p className="text-muted-foreground mb-4">Please select a tree to work on.</p>
                            <Button onClick={() => router.push('/roots')}>Go to Manage Roots</Button>
                        </CardContent>
                    </Card>
                </main>
            </div>
        </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-muted/20">
        <AppHeader />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <TooltipProvider>
          <div className="grid md:grid-cols-5 lg:grid-cols-3 gap-8 items-start">
            <div className="md:col-span-2 lg:col-span-1 flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Your Templates</CardTitle>
                  <CardDescription>Select a template to edit or create a new one.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={handleCreateNew} className="w-full">
                    <PlusCircle className="mr-2 h-4 w-4" /> Create New Template
                  </Button>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="mr-2 h-4 w-4" /> Import Archive
                    </Button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImport}
                        accept=".zip"
                        className="hidden"
                    />
                    <Button variant="outline" onClick={handleExportAll}>
                        <Archive className="mr-2 h-4 w-4" /> Export Archive
                    </Button>
                  </div>
                   <Separator />
                   <div className="relative">
                     <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                     <Input
                       type="search"
                       placeholder="Filter templates..."
                       value={searchTerm}
                       onChange={(e) => setSearchTerm(e.target.value)}
                       className="pl-9"
                     />
                   </div>
                </CardContent>
              </Card>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filteredTemplates.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {filteredTemplates.map((template) => {
                      const usageCount = templateUsage.get(template.id) || 0;
                      const isInUse = usageCount > 0;
                      return (
                      <DraggableTemplateWrapper key={template.id} id={template.id}>
                        <Card className="hover:shadow-md transition-shadow">
                          <CardContent className="p-2 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <Icon
                                  name={(template.icon as keyof typeof icons) || 'FileText'}
                                  className="h-6 w-6"
                                  style={{ color: template.color || 'hsl(var(--primary))' }}
                                />
                              <div>
                                <h3 className="font-semibold">{template.name}</h3>
                                <p className="text-sm text-muted-foreground">{usageCount} node{usageCount !== 1 ? 's' : ''} using</p>
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleSelectTemplate(template)}>
                                  <Edit className="h-4 w-4" />
                                </Button>

                              <AlertDialog>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div tabIndex={isInUse ? 0 : undefined}>
                                        <AlertDialogTrigger asChild>
                                          <Button variant="ghost" size="icon" disabled={isInUse} className="text-destructive hover:text-destructive">
                                              <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </AlertDialogTrigger>
                                      </div>
                                    </TooltipTrigger>
                                     {isInUse && (
                                      <TooltipContent>
                                        <p>This template is in use and cannot be deleted.</p>
                                      </TooltipContent>
                                    )}
                                  </Tooltip>

                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This action cannot be undone. This will permanently delete the "{template.name}" template.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteTemplate(template.id)} className="bg-destructive hover:bg-destructive/90">
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </CardContent>
                        </Card>
                      </DraggableTemplateWrapper>
                    )})}
                  </div>
                </SortableContext>
              </DndContext>
               {filteredTemplates.length === 0 && (
                <Card className="flex flex-col items-center justify-center p-6 border-dashed">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold">No Templates Found</h3>
                    <p className="text-muted-foreground">
                      {searchTerm ? `Your search for "${searchTerm}" did not return any results.` : "Create or import a template to get started."}
                    </p>
                  </div>
                </Card>
              )}
            </div>

            <div className="md:col-span-3 lg:col-span-2">
              {selectedTemplate ? (
                <TemplateDesigner
                  template={selectedTemplate}
                  allTemplates={templates}
                  onSave={handleSaveTemplate}
                  onCancel={() => setSelectedTemplate(null)}
                />
              ) : (
                <Card className="flex flex-col items-center justify-center h-96 border-dashed">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold">Select a template</h3>
                    <p className="text-muted-foreground">Choose a template from the list to edit, or create a new one.</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
          </TooltipProvider>
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default TemplatesPage;
