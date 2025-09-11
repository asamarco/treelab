

/**
 * @fileoverview
 * This component manages all the dialogs (modals) for a single tree node.
 * This keeps the modal logic separate from the node rendering.
 */
"use client";

import { useState, useEffect, useMemo } from "react";
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";


interface TreeNodeModalsProps {
  node: TreeNode;
  template: Template;
  openModal: null | 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate';
  onOpenChange: (modal: null | 'addChild' | 'addSibling' | 'edit' | 'changeTemplate' | 'pasteTemplate') => void;
  contextualParentId: string | null;
}

export function TreeNodeModals({ node, template, openModal, onOpenChange, contextualParentId }: TreeNodeModalsProps) {
  const { templates, getTemplateById, addChildNode, addSiblingNode, updateNode, changeNodeTemplate, clipboard, activeTree } = useTreeContext();
  const { currentUser } = useAuthContext();
  const { toast } = useToast();

  const [selectedTemplateForNewNode, setSelectedTemplateForNewNode] = useState<Template | null>(null);
  const [selectedNewTemplateId, setSelectedNewTemplateId] = useState<string | null>(null);
  
  const isOwner = activeTree?.userId === currentUser?.id;

  useEffect(() => {
    // Pre-fill template for 'pasteTemplate' action
    if (openModal === 'pasteTemplate' && clipboard.nodes && clipboard.nodes.length > 0) {
      const templateFromClipboard = getTemplateById(clipboard.nodes[0].templateId);
      if (templateFromClipboard) {
        setSelectedTemplateForNewNode(templateFromClipboard);
      } else {
        // Fallback if template not found, though this shouldn't happen
        onOpenChange(null);
      }
    }
  }, [openModal, clipboard.nodes, getTemplateById, onOpenChange]);

  const handleClose = () => {
    onOpenChange(null);
    setSelectedTemplateForNewNode(null);
    setSelectedNewTemplateId(null);
  }

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
    if (!selectedTemplateForNewNode) {
      return (
        <div className="space-y-2 py-4">
          <Label>Select a template for the new node</Label>
          <Select onValueChange={(templateId) => setSelectedTemplateForNewNode(getTemplateById(templateId) ?? null)}>
            <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    return <NodeForm template={selectedTemplateForNewNode} onSave={onSave} onClose={handleClose} contextualParentId={contextualParentId} />;
  }

  return (
    <>
      {/* Add Child / Paste Template Dialog */}
      <Dialog open={openModal === 'addChild' || openModal === 'pasteTemplate'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent>
          <DialogHeader><DialogTitle><CornerDownRight className="inline-block mr-2 h-5 w-5" />Add New Node to "{node.name}"</DialogTitle></DialogHeader>
          {renderAddDialogContent(handleSaveNewChild)}
        </DialogContent>
      </Dialog>

      {/* Add Sibling Dialog */}
      <Dialog open={openModal === 'addSibling'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent>
          <DialogHeader><DialogTitle><ListPlus className="inline-block mr-2 h-5 w-5" />Add Sibling After "{node.name}"</DialogTitle></DialogHeader>
          {renderAddDialogContent(handleSaveNewSibling)}
        </DialogContent>
      </Dialog>

      {/* Edit Node Dialog */}
      <Dialog open={openModal === 'edit'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit Node: {node.name}</DialogTitle></DialogHeader>
          <NodeForm node={node} template={template} onSave={handleSaveUpdate} onClose={handleClose} contextualParentId={contextualParentId} />
        </DialogContent>
      </Dialog>

      {/* Change Template Dialog */}
      <Dialog open={openModal === 'changeTemplate'} onOpenChange={(open) => !open && handleClose()}>
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
