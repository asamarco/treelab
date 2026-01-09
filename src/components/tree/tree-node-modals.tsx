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


interface TreeNodeModalsProps {
  node: TreeNode;
  template: Template;
}

export function TreeNodeModals({ node, template }: TreeNodeModalsProps) {
  const { templates, getTemplateById, addChildNode, addSiblingNode, updateNode, changeNodeTemplate, clipboard, activeTree, setSelectedNodeIds, findNodeAndParent } = useTreeContext();
  const { currentUser } = useAuthContext();
  const { toast } = useToast();
  const { dialogState, setDialogState, setIgnoreClicksUntil } = useUIContext();
  const router = useRouter();

  const [selectedTemplateForNewNode, setSelectedTemplateForNewNode] = useState<Template | null>(null);
  const [selectedNewTemplateId, setSelectedNewTemplateId] = useState<string | null>(null);
  
  const isOwner = activeTree?.userId === currentUser?.id;
  
  const { openModal, contextualParentId } = useMemo(() => {
    if (dialogState.nodeInstanceIdForAction?.startsWith(node.id)) {
        const instanceId = dialogState.nodeInstanceIdForAction;
        const parentId = instanceId.substring(node.id.length + 1) || 'root';

        if (dialogState.isAddChildOpen) return { openModal: 'addChild', contextualParentId: parentId === 'root' ? null : parentId };
        if (dialogState.isAddSiblingOpen) return { openModal: 'addSibling', contextualParentId: parentId === 'root' ? null : parentId };
        if (dialogState.isNodeEditOpen) return { openModal: 'edit', contextualParentId: parentId === 'root' ? null : parentId };
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
    setDialogState({ 
        isAddChildOpen: false, 
        isAddSiblingOpen: false,
        isNodeEditOpen: false,
        isChangeTemplateOpen: false,
        isPasteTemplateOpen: false,
        nodeInstanceIdForAction: undefined 
    });
    setSelectedTemplateForNewNode(null);
    setSelectedNewTemplateId(null);
    setSelectedNodeIds([]);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIgnoreClicksUntil(Date.now() + 500);
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
      toast({variant: 'destructive', title: "Permission Denied", description: "Only the owner can change a node's template."});
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
        <DialogContent>
          <DialogHeader><DialogTitle><CornerDownRight className="inline-block mr-2 h-5 w-5" />Add New Node to "{node.name}"</DialogTitle></DialogHeader>
          {renderAddDialogContent(handleSaveNewChild)}
        </DialogContent>
      </Dialog>

      {/* Add Sibling Dialog */}
      <Dialog open={openModal === 'addSibling'} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle><ListPlus className="inline-block mr-2 h-5 w-5" />Add Sibling After "{node.name}"</DialogTitle></DialogHeader>
          {renderAddDialogContent(handleSaveNewSibling)}
        </DialogContent>
      </Dialog>

      {/* Edit Node Dialog */}
      <Dialog open={openModal === 'edit'} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit Node: {node.name}</DialogTitle></DialogHeader>
          <NodeForm node={node} template={template} onSave={handleSaveUpdate} onClose={handleClose} contextualParentId={contextualParentId} />
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
