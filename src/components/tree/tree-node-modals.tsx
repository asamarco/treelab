/**
 * @fileoverview
 * This component manages all the dialogs (modals) for a single tree node.
 * This keeps the modal logic separate from the node rendering.
 */
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "../ui/select";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { NodeForm } from "@/components/tree/node-form";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { useToast } from "@/hooks/use-toast";
import { Template, TreeFile, GitCommit, TreeNode } from "@/lib/types";
import { Github, Loader2, Eye, AlertTriangle, RefreshCcw, ArrowLeft, ArrowRight, ArrowUp, Printer, Download, FileJson, FileCode, FileText, Archive, ChevronDown, CornerDownRight, ListPlus } from "lucide-react";
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { HtmlExportView } from "./html-export-view";
import { TreeView } from "./tree-view";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useUIContext } from "@/contexts/ui-context";
// import { PdfExportDialog } from "./pdf-export-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from "../ui/dropdown-menu";
import { Icon } from "../icon";
import { icons } from "lucide-react";
import { Separator } from "../ui/separator";
import { ChildNodeQuickEdit } from "./child-node-quick-edit";
import { cn } from "@/lib/utils";


interface TreeNodeModalsProps {
  node: TreeNode;
  template: Template;
}

export function TreeNodeModals({ node, template }: TreeNodeModalsProps) {
  const { templates, getTemplateById, addChildNode, addSiblingNode, updateNode, changeNodeTemplate, clipboard, activeTree, setSelectedNodeIds, findNodeAndParent } = useTreeContext();
  const { currentUser, setShowChildrenInEditForm } = useAuthContext();
  const { toast } = useToast();
  const { dialogState, setDialogState, setIgnoreClicksUntil } = useUIContext();
  const router = useRouter();

  const [selectedTemplateForNewNode, setSelectedTemplateForNewNode] = useState<Template | null>(null);
  const [selectedNewTemplateId, setSelectedNewTemplateId] = useState<string | null>(null);
  const showChildPanel = currentUser?.showChildrenInEditForm ?? false;

  const isOwner = activeTree?.userId === currentUser?.id;

  const { openModal, contextualParentId } = useMemo(() => {
    const editInstanceId = dialogState.openNodeEditInstanceIds?.find(id => id.startsWith(node.id + "_"));
    if (editInstanceId) {
      const parentId = editInstanceId.substring(node.id.length + 1) || 'root';
      return { openModal: 'edit', contextualParentId: parentId === 'root' ? null : parentId };
    }

    if (dialogState.nodeInstanceIdForAction?.startsWith(node.id + "_")) {
      const instanceId = dialogState.nodeInstanceIdForAction;
      const parentId = instanceId.substring(node.id.length + 1) || 'root';

      if (dialogState.isAddChildOpen) return { openModal: 'addChild', contextualParentId: parentId === 'root' ? null : parentId };
      if (dialogState.isAddSiblingOpen) return { openModal: 'addSibling', contextualParentId: parentId === 'root' ? null : parentId };
      if (dialogState.isChangeTemplateOpen) return { openModal: 'changeTemplate', contextualParentId: parentId === 'root' ? null : parentId };
      if (dialogState.isPasteTemplateOpen) return { openModal: 'pasteTemplate', contextualParentId: parentId === 'root' ? null : parentId };
    }
    return { openModal: null, contextualParentId: null };
  }, [dialogState, node.id]);


  useEffect(() => {
    if (openModal === 'addSibling') {
      const parentInfo = findNodeAndParent(node.id);
      const parentTemplate = parentInfo?.parent ? getTemplateById(parentInfo.parent.templateId) : undefined;
      setSelectedTemplateForNewNode(template);
    } else if (openModal === 'addChild') {
      const firstPreferredId = template.preferredChildTemplates?.[0];
      if (firstPreferredId) {
        setSelectedTemplateForNewNode(getTemplateById(firstPreferredId) ?? null);
      } else {
        setSelectedTemplateForNewNode(null);
      }
    }
    else if (openModal === 'pasteTemplate' && clipboard.nodes && clipboard.nodes.length > 0) {
      const templateFromClipboard = getTemplateById(clipboard.nodes[0].templateId);
      if (templateFromClipboard) {
        setSelectedTemplateForNewNode(templateFromClipboard);
      } else {
        handleClose();
      }
    }
  }, [openModal, template, clipboard.nodes, getTemplateById, node.id, findNodeAndParent]);

  const handleClose = () => {
    setIgnoreClicksUntil(Date.now() + 500);
    if (openModal === 'edit') {
      const editInstanceId = dialogState.openNodeEditInstanceIds?.find(id => id.startsWith(node.id + "_"));
      setDialogState({
        openNodeEditInstanceIds: dialogState.openNodeEditInstanceIds?.filter(id => id !== editInstanceId)
      });
    } else {
      setDialogState({
        isAddChildOpen: false,
        isAddSiblingOpen: false,
        isChangeTemplateOpen: false,
        isPasteTemplateOpen: false,
        nodeInstanceIdForAction: undefined
      });
    }
    setSelectedTemplateForNewNode(null);
    setSelectedNewTemplateId(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose();
    }
  };

  const handleSaveNewChild = (childNodeData: TreeNode) => {
    const { id, children, ...rest } = childNodeData;
    addChildNode(node.id, rest, contextualParentId);
    handleClose();
  };

  const handleSaveNewSibling = (siblingNodeData: TreeNode) => {
    const { id, children, ...rest } = siblingNodeData;
    addSiblingNode(node.id, rest, contextualParentId);
    handleClose();
  }

  const handleSaveUpdate = (updatedNodeData: TreeNode) => {
    const { id, children, ...rest } = updatedNodeData;
    updateNode(node.id, rest);
    handleClose();
  };

  const handleChangeTemplate = () => {
    if (!isOwner) {
      toast({ variant: 'destructive', title: "Permission Denied", description: "Only the owner can change a node's template." });
      return;
    }
    if (selectedNewTemplateId) {
      changeNodeTemplate(node.id, selectedNewTemplateId);
      toast({
        title: "Template Changed",
        description: `Node "${node.name}" has been updated to the new template.`,
      });
      handleClose();
    }
  };

  const renderAddDialogContent = (onSave: (data: TreeNode) => void) => {
    const currentTemplate = selectedTemplateForNewNode;

    // Determine the correct parent template for showing preferred children
    const parentNodeForContext = (openModal === 'addChild' ? node : findNodeAndParent(node.id)?.parent);
    const parentTemplateForContext = parentNodeForContext ? getTemplateById(parentNodeForContext.templateId) : undefined;

    const preferredTemplates = (parentTemplateForContext?.preferredChildTemplates || [])
      .map(id => getTemplateById(id))
      .filter((t): t is Template => !!t);

    const otherTemplates = templates.filter(t => !(parentTemplateForContext?.preferredChildTemplates || []).includes(t.id));

    const hasPreferred = preferredTemplates.length > 0;
    const hasOthers = otherTemplates.length > 0;

    return (
      <>
        <div className="space-y-2 pt-4">
          <Label>Template</Label>
          <Select
            value={currentTemplate?.id}
            onValueChange={(templateId) => {
              if (templateId === 'create_new') {
                router.push('/templates');
                handleClose();
                return;
              }
              setSelectedTemplateForNewNode(getTemplateById(templateId) ?? null)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a template">
                {currentTemplate ? (
                  <div className="flex items-center gap-2">
                    <Icon
                      name={(currentTemplate.icon as keyof typeof icons) || "FileText"}
                      className="h-4 w-4"
                      style={{ color: currentTemplate.color || "hsl(var(--primary))" }}
                    />
                    <span>{currentTemplate.name}</span>
                  </div>
                ) : (
                  "Select a template"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {hasPreferred ? (
                <SelectGroup>
                  <SelectLabel>Preferred</SelectLabel>
                  {preferredTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <Icon
                          name={(t.icon as keyof typeof icons) || "FileText"}
                          className="h-4 w-4"
                          style={{ color: t.color || "hsl(var(--primary))" }}
                        />
                        <span>{t.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}

              {hasOthers && hasPreferred && <SelectSeparator />}

              {hasOthers ? (
                <SelectGroup>
                  {hasPreferred && <SelectLabel>Other Templates</SelectLabel>}
                  {otherTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <Icon
                          name={(t.icon as keyof typeof icons) || "FileText"}
                          className="h-4 w-4"
                          style={{ color: t.color || "hsl(var(--primary))" }}
                        />
                        <span>{t.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}

              <Separator className="my-1" />
              <SelectItem value="create_new">
                <div className="flex items-center gap-2 text-primary">
                  <ListPlus className="h-4 w-4" />
                  <span>Create new template...</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {currentTemplate && (
          <NodeForm template={currentTemplate} onSave={onSave} onClose={handleClose} contextualParentId={contextualParentId} />
        )}
      </>
    );
  }

  return (
    <>
      {/* Add Child / Paste Template Dialog */}
      <Dialog open={openModal === 'addChild' || openModal === 'pasteTemplate'} onOpenChange={handleOpenChange}>
        <DialogContent
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.jcontextmenu') || target.closest('.jcolor') || target.closest('.jexcel')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader><DialogTitle><CornerDownRight className="inline-block mr-2 h-5 w-5" />Add New Node to "{node.name}"</DialogTitle></DialogHeader>
          {renderAddDialogContent(handleSaveNewChild)}
        </DialogContent>
      </Dialog>

      {/* Add Sibling Dialog */}
      <Dialog open={openModal === 'addSibling'} onOpenChange={handleOpenChange}>
        <DialogContent
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.jcontextmenu') || target.closest('.jcolor') || target.closest('.jexcel')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader><DialogTitle><ListPlus className="inline-block mr-2 h-5 w-5" />Add Sibling After "{node.name}"</DialogTitle></DialogHeader>
          {renderAddDialogContent(handleSaveNewSibling)}
        </DialogContent>
      </Dialog>

      {/* Edit Node Dialog */}
      <Dialog open={openModal === 'edit'} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn("max-h-[90vh] flex flex-col transition-all duration-300", showChildPanel ? "max-w-5xl" : "max-w-2xl")}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.jcontextmenu') || target.closest('.jcolor') || target.closest('.jexcel')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader className="flex flex-row items-center justify-between pr-6">
            <DialogTitle>Edit Node: {node.name}</DialogTitle>
            {node.children && node.children.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowChildrenInEditForm(!showChildPanel)}
                className="ml-auto"
              >
                {showChildPanel ? "Hide Children" : "Show Children"}
              </Button>
            )}
          </DialogHeader>

          <div className={cn("flex flex-1 overflow-hidden gap-4", showChildPanel ? "flex-row" : "flex-col")}>
            <div className={cn("flex-1 overflow-y-auto px-1", showChildPanel ? "pr-4 border-r" : "")}>
              <NodeForm node={node} template={template} onSave={handleSaveUpdate} onClose={handleClose} contextualParentId={contextualParentId} />
            </div>

            {showChildPanel && node.children && node.children.length > 0 && (
              <div className="w-[350px] shrink-0 overflow-y-auto pr-1 space-y-4">
                <div className="text-sm font-medium text-muted-foreground sticky top-0 bg-background pb-2 z-10 border-b">
                  Children ({node.children.length})
                </div>
                {node.children.map(child => {
                  const childTemplate = getTemplateById(child.templateId);
                  if (!childTemplate) return null;
                  return (
                    <ChildNodeQuickEdit
                      key={child.id}
                      node={child}
                      template={childTemplate}
                      onSave={(updatedChild) => {
                        updateNode(updatedChild.id, updatedChild);
                        toast({ title: "Child Updated", description: `Saved changes to ${updatedChild.name}` });
                      }}
                      onFullEdit={(childId) => {
                        const newInstanceId = `${childId}_${node.id}`;
                        const currentIds = dialogState.openNodeEditInstanceIds || [];
                        if (!currentIds.includes(newInstanceId)) {
                          setDialogState({
                            openNodeEditInstanceIds: [...currentIds, newInstanceId]
                          });
                        }
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Template Dialog */}
      <Dialog open={openModal === 'changeTemplate'} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Template for "{node.name}"</DialogTitle>
            <DialogDescription>Select a new template. Data for fields with the same name will be preserved.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="new-template-select">New Template</Label>
            <Select onValueChange={setSelectedNewTemplateId}>
              <SelectTrigger id="new-template-select">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.filter(t => t.id !== node.templateId).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={handleChangeTemplate} disabled={!selectedNewTemplateId}>Change Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
