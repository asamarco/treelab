

/**
 * @fileoverview
 * This file defines the `NodeForm` component, which is a dynamic form used for
 * creating and editing tree nodes. The form's fields are generated based on the
 * provided `Template`.
 *
 * It supports various field types (text, date, dropdown, picture, table, etc.) and
 * handles data input and state management for the node being edited. On submission,
 * it automatically generates the node's name based on the `nameTemplate` and calls
 * the `onSave` callback with the new node data.
 */
"use client";

import React, { useState, useRef, useMemo, useEffect } from "react";
import { TreeNode, Template, Field, AttachmentInfo, XYChartData, QueryDefinition, QueryRule, ConditionalRuleOperator, ChecklistItem, SimpleQueryRule } from "@/lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar as CalendarIcon, Upload, PlusCircle, Trash2, Loader2, ImagePlus, X, Paperclip, File as FileIcon, Link, GripVertical } from "lucide-react";
import { format, parse, isValid, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { DialogFooter, DialogClose } from "../ui/dialog";
import { Label } from "../ui/label";
import { useToast } from "@/hooks/use-toast";
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
import { useTreeContext } from "@/contexts/tree-context";
import { useAuthContext } from "@/contexts/auth-context";
import { Combobox } from "../ui/combobox";
import { generateNodeName, formatDate, generateClientSideId } from "@/lib/utils";
import { Card, CardContent } from "../ui/card";
import path from "path";
import { Separator } from "../ui/separator";
import { useUIContext } from "@/contexts/ui-context";
import { DatePicker } from "../ui/date-picker";


const DraggableImage = ({ id, src, onRemove, onDoubleClick }: { id: string; src: string; onRemove: () => void; onDoubleClick: () => void; }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 100 : 'auto',
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="relative group aspect-square">
            <img 
              src={src} 
              alt="preview" 
              className="w-full h-full object-cover rounded-md" 
              onDoubleClick={onDoubleClick}
            />
            <Button {...attributes} {...listeners} type="button" variant="ghost" size="icon" className="absolute top-1 left-1 h-6 w-6 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 hover:bg-background/80">
                <GripVertical className="h-4 w-4" />
            </Button>
            <Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={onRemove}>
                <X className="h-4 w-4" />
            </Button>
        </div>
    );
};

const DraggableCheckboxItem = ({ id, children }: { id: string; children: React.ReactNode; }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 100 : 'auto',
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-2 w-full">
            <Button {...attributes} {...listeners} type="button" variant="ghost" size="icon" className="h-8 w-8 cursor-grab shrink-0">
                <GripVertical className="h-4 w-4" />
            </Button>
            {children}
        </div>
    );
};

const operatorLabels: Record<ConditionalRuleOperator, string> = {
  equals: 'Equals',
  not_equals: 'Not Equals',
  contains: 'Contains',
  not_contains: 'Does Not Contain',
  is_not_empty: 'Is Not Empty',
  is_empty: 'Is Empty',
  greater_than: 'Greater Than',
  less_than: 'Less Than',
};


export const NodeForm = ({
  node,
  template,
  onSave,
  onClose,
  contextualParentId,
  isMultiEdit = false,
}: {
  node?: Partial<TreeNode>;
  template: Template;
  onSave: (data: TreeNode) => void;
  onClose: () => void;
  contextualParentId: string | null;
  isMultiEdit?: boolean;
}) => {
  const { tree, uploadAttachment, activeTree, findNodeAndParent, getSiblingOrderRange, templates } = useTreeContext();
  const { setDialogState } = useUIContext();
  
  //console.log('[NodeForm] Rendering form for:', node?.name || 'New Node');
  
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    if (isMultiEdit) return {};
    //console.log('[NodeForm] Initializing state with node data:', node?.data);
    const initialData = { ...(node?.data || {}) };
    
    // Convert ISO date strings from DB to yyyy-MM-dd for DatePicker
    template.fields.forEach(field => {
      if (field.type === 'date' && initialData[field.id] && typeof initialData[field.id] === 'string') {
        const parsed = parseISO(initialData[field.id]);
        if (isValid(parsed)) {
          initialData[field.id] = format(parsed, 'yyyy-MM-dd');
        }
      } else if (field.type === 'table-header' && field.columnType === 'date' && Array.isArray(initialData[field.id])) {
        initialData[field.id] = initialData[field.id].map((dateStr: string) => {
          if (typeof dateStr === 'string') {
            const parsed = parseISO(dateStr);
            return isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : dateStr;
          }
          return dateStr;
        });
      }
    });

    return initialData;
  });

  const { toast } = useToast();
  const { currentUser } = useAuthContext();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingStates, setUploadingStates] = useState<Record<string, boolean>>({});
  const [dragOverStates, setDragOverStates] = useState<Record<string, boolean>>({});
  const sensors = useSensors(useSensor(PointerSensor));

  const parentIndex = contextualParentId ? (node?.parentIds || []).indexOf(contextualParentId) : 0;
  const contextualOrder = (parentIndex !== -1 && node?.order && (node.order.length > parentIndex))
    ? node.order[parentIndex]
    : 0;
  
  const [orderString, setOrderString] = useState(contextualOrder.toString());

  useEffect(() => {
      const parentIndex = contextualParentId ? (node?.parentIds || []).indexOf(contextualParentId) : 0;
      const contextualOrder = (parentIndex !== -1 && node?.order && (node.order.length > parentIndex))
        ? node.order[parentIndex]
        : 0;
      setOrderString(contextualOrder.toString());
  }, [node, contextualParentId]);


  const tableHeaderFields = useMemo(() => template.fields.filter(f => f.type === 'table-header'), [template.fields]);

  const getDynamicOptions = useMemo(() => {
    return (fieldId: string, templateId: string): {value: string, label: string}[] => {
      const values = new Set<string>();
      
      const traverse = (nodes: TreeNode[]) => {
        nodes.forEach(n => {
          if (n.templateId === templateId) {
            const value = (n.data || {})[fieldId];
            if (typeof value === 'string' && value) {
              values.add(value);
            }
          }
          if (n.children) {
            traverse(n.children);
          }
        });
      };
      
      traverse(tree);
      return Array.from(values).map(v => ({ value: v, label: v }));
    };
  }, [tree]);

  const handleFileUpload = async (file: File, field: Field) => {
    //console.log(`[NodeForm] handleFileUpload started for field ${field.id}, file: ${file.name}`);
    if (!activeTree || !currentUser) return;
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
            variant: "destructive",
            title: "File too large",
            description: "Please select a file smaller than 5MB.",
        });
        return;
    }
    
    // Client-side validation for image types before attempting upload
    if (field.type === 'picture') {
        const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/tiff', 'image/bmp'];
        const isValidMime = validImageTypes.includes(file.type);
        const isValidExtension = /\.(jpe?g|png|gif|svg|tif|tiff|bmp)$/i.test(file.name);

        if (!isValidMime && !isValidExtension) {
            toast({ variant: "destructive", title: "Invalid File Type", description: "Please upload a valid image file (jpg, png, gif, svg, tiff, webp, bmp)." });
            return;
        }
    }

    setUploadingStates(prev => ({...prev, [field.id]: true}));
    
    const uniqueFileName = `${new Date().toISOString()}-${Math.random().toString(36).substring(2, 11)}-${file.name}`;
        
    const formDataPayload = new FormData();
    formDataPayload.append('file', file);
    formDataPayload.append('uniqueFileName', uniqueFileName);
    formDataPayload.append('fileName', file.name);

    try {
        const response = await fetch('/api/upload/attachment', {
            method: 'POST',
            body: formDataPayload,
            credentials: 'include',
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody.message || 'Server error');
        }

        const { attachmentInfo } = await response.json();
        
        if (attachmentInfo) {
            //console.log('[NodeForm] File upload successful, attachmentInfo:', attachmentInfo);
            if (field.type === 'picture') {
                 setFormData(prev => {
                  //console.log(`[NodeForm] Updating form data for picture field ${field.id}. Prev state:`, prev[field.id]);
                  const currentImages = Array.isArray(prev[field.id]) ? prev[field.id] : (prev[field.id] ? [prev[field.id]] : []);
                  const newState = { ...prev, [field.id]: [...currentImages, attachmentInfo.path] };
                  //console.log(`[NodeForm] New picture state for ${field.id}:`, newState[field.id]);
                  return newState;
              });
              toast({ title: "Image Uploaded", description: "The image has been saved successfully." });
            } else if (field.type === 'attachment') {
               setFormData(prev => {
                  //console.log(`[NodeForm] Updating form data for attachment field ${field.id}.`);
                  const currentAttachments = prev[field.id] || [];
                  return { ...prev, [field.id]: [...currentAttachments, attachmentInfo] };
              });
              toast({ title: "Attachment Uploaded", description: `File "${file.name}" has been saved.` });
            }
        }
    } catch(error) {
        toast({ variant: "destructive", title: "Upload Failed", description: (error as Error).message || "Could not save the file to the server." });
    } finally {
        //console.log(`[NodeForm] handleFileUpload finished for field ${field.id}`);
        setUploadingStates(prev => ({...prev, [field.id]: false}));
    }
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, field: Field) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverStates(prev => ({ ...prev, [field.id]: false }));
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(file => handleFileUpload(file, field));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, fieldId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverStates(prev => ({ ...prev, [fieldId]: true }));
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, fieldId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverStates(prev => ({ ...prev, [fieldId]: false }));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>, field: Field) => {
      const files = e.target.files;
      if (files) {
          Array.from(files).forEach(file => handleFileUpload(file, field));
      }
  };

  const handlePicturePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>, fieldId: string) => {
    //console.log(`[NodeForm] handlePicturePaste for field ${fieldId}`);
    const clipboardItems = e.clipboardData.items;
    const textItem = e.clipboardData.getData('text/plain');

    if (textItem && (textItem.startsWith('http') || textItem.startsWith('data:'))) {
        e.preventDefault();
        const currentImages = formData[fieldId] ? (Array.isArray(formData[fieldId]) ? formData[fieldId] : [formData[fieldId]]) : [];
        setFormData({ ...formData, [fieldId]: [...currentImages, textItem] });
        (e.target as HTMLTextAreaElement).value = '';
        return;
    }
    
    const imageItem = Array.from(clipboardItems).find(item => item.type.startsWith('image/'));
    
    if (!imageItem) return;
    e.preventDefault();

    const file = imageItem.getAsFile();
    if (file) {
        //console.log('[NodeForm] Pasted an image file from clipboard.');
        const field = template.fields.find(f => f.id === fieldId);
        if (field) {
            handleFileUpload(file, field);
        }
    }
  };

  const handleRemoveImage = (fieldId: string, imageIndex: number) => {
    setFormData(prev => {
        const currentImages = Array.isArray(prev[fieldId]) ? prev[fieldId] : (prev[fieldId] ? [prev[fieldId]] : []);
        const newImages = currentImages.filter((_:any, index: number) => index !== imageIndex);
        return { ...prev, [fieldId]: newImages };
    });
  };

  const handleRemoveAttachment = (fieldId: string, attachmentIndex: number) => {
    setFormData(prev => {
        const currentAttachments = prev[fieldId] || [];
        const newAttachments = currentAttachments.filter((_: any, index: number) => index !== attachmentIndex);
        return { ...prev, [fieldId]: newAttachments };
    });
  };

  const handleImageDragEnd = (event: DragEndEvent, fieldId: string) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
        setFormData(prev => {
            const currentImages = prev[fieldId];
            if (Array.isArray(currentImages)) {
                const oldIndex = currentImages.indexOf(active.id as string);
                const newIndex = currentImages.indexOf(over.id as string);
                const newImageOrder = arrayMove(currentImages, oldIndex, newIndex);
                return { ...prev, [fieldId]: newImageOrder };
            }
            return prev;
        });
    }
  };


  const handleTableChange = (rowIndex: number, fieldId: string, value: string | undefined) => {
    setFormData(prev => {
      const newFormData = { ...prev };
      const currentData = Array.isArray(newFormData[fieldId]) ? [...newFormData[fieldId]] : [];
      currentData[rowIndex] = value;
      newFormData[fieldId] = currentData;
      return newFormData;
    });
  };
  
  const getTableRowCount = () => {
    if (tableHeaderFields.length === 0) return 0;
    const firstColumnData = formData[tableHeaderFields[0].id];
    return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
  };
  
  const handleAddRow = () => {
    setFormData(prev => {
        const newFormData = { ...prev };
        tableHeaderFields.forEach(field => {
            const currentData = Array.isArray(newFormData[field.id]) ? [...newFormData[field.id]] : [];
            currentData.push('');
            newFormData[field.id] = currentData;
        });
        return newFormData;
    });
  };

  const handleRemoveRow = (rowIndex: number) => {
    setFormData(prev => {
        const newFormData = { ...prev };
        tableHeaderFields.forEach(field => {
            if (Array.isArray(newFormData[field.id])) {
                const newColumnData = [...newFormData[field.id]];
                newColumnData.splice(rowIndex, 1);
                newFormData[field.id] = newColumnData;
            }
        });
        return newFormData;
    });
  };

  const handleChartDataChange = (fieldId: string, index: number, key: 'x' | 'y' | 'xAxisLabel' | 'yAxisLabel', value: string) => {
    setFormData(prev => {
        const currentChartData: XYChartData = prev[fieldId] || { points: [] };
        if (key === 'xAxisLabel' || key === 'yAxisLabel') {
            return {
                ...prev,
                [fieldId]: { ...currentChartData, [key]: value },
            };
        }
        const newPoints = [...(currentChartData.points || [])];
        if (newPoints[index]) {
            newPoints[index] = { ...newPoints[index], [key]: value };
        }
        return {
            ...prev,
            [fieldId]: { ...currentChartData, points: newPoints },
        };
    });
  };

  const handleAddChartRow = (fieldId: string) => {
      setFormData(prev => {
          const currentChartData: XYChartData = prev[fieldId] || { points: [] };
          const points = currentChartData.points || [];
          return {
              ...prev,
              [fieldId]: { ...currentChartData, points: [...points, { x: '', y: '' }] },
          };
      });
  };

  const handleRemoveChartRow = (fieldId: string, index: number) => {
      setFormData(prev => {
          const currentChartData: XYChartData = prev[fieldId] || { points: [] };
          const newPoints = [...(currentChartData.points || [])];
          newPoints.splice(index, 1);
          return {
              ...prev,
              [fieldId]: { ...currentChartData, points: newPoints },
          };
      });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    //console.log('[NodeForm] handleSubmit triggered. Current form data:', formData);
    
    if (isMultiEdit) {
        const dirtyData: Record<string, any> = {};
        let isFormValid = true;

        for (const field of template.fields) {
            const value = formData[field.id];
            if (value !== undefined && value !== '') {
                if (field.type === 'date' && typeof value === 'string') {
                    const parsedDate = parse(value, 'yyyy-MM-dd', new Date());
                    if (isValid(parsedDate)) {
                        dirtyData[field.id] = parsedDate.toISOString();
                    } else {
                        toast({ variant: 'destructive', title: 'Invalid Date', description: `Date for "${field.name}" is invalid.` });
                        isFormValid = false;
                        break;
                    }
                } else {
                    dirtyData[field.id] = value;
                }
            }
        }
        if (isFormValid) {
            onSave({ data: dirtyData } as TreeNode);
        }
        return;
    }

    const finalFormData = { ...formData };
    let isFormValid = true;

    for (const field of template.fields) {
      if (field.type === 'date' || (field.type === 'table-header' && field.columnType === 'date')) {
        const values = Array.isArray(finalFormData[field.id]) ? finalFormData[field.id] : [finalFormData[field.id]];
        
        const isoValues = values.map((dateValue: string | undefined) => {
            if (!dateValue) return undefined;
            if (typeof dateValue !== 'string') return dateValue;
            
            const parsedDate = parse(dateValue, 'yyyy-MM-dd', new Date());

            if (isValid(parsedDate)) {
                return parsedDate.toISOString();
            } else if (dateValue) { // if there's a value but it's not valid
                toast({
                    variant: 'destructive',
                    title: 'Invalid Date',
                    description: `The date for "${field.name}" is not a valid format. Please use the date picker.`,
                });
                isFormValid = false;
                return dateValue;
            }
            return undefined;
        });

        if (!isFormValid) break;

        if (field.type === 'date') {
          finalFormData[field.id] = isoValues[0];
        } else {
          finalFormData[field.id] = isoValues;
        }
      }
    }
    
    if (!isFormValid) {
        return;
    }

    const finalName = generateNodeName(template, finalFormData);
    const newOrderValue = parseInt(orderString, 10);
    
    const newOrderArray = [...(node?.order || [])];
    if (parentIndex !== -1) {
        newOrderArray[parentIndex] = isNaN(newOrderValue) ? contextualOrder : newOrderValue;
    } else if (node?.parentIds) {
        // This case should ideally not happen if we're editing contextually, but as a fallback:
        newOrderArray.push(isNaN(newOrderValue) ? 0 : newOrderValue);
    } else {
        newOrderArray[0] = isNaN(newOrderValue) ? 0 : newOrderValue;
    }


    const newNode: TreeNode = {
      id: node?.id || new Date().toISOString(),
      name: finalName,
      templateId: template.id,
      data: finalFormData || {},
      children: node?.children || [],
      userId: node?.userId || '',
      treeId: node?.treeId || '',
      parentIds: node?.parentIds || [],
      order: newOrderArray,
    };
    //console.log('[NodeForm] Calling onSave with new node data:', newNode);
    onSave(newNode);
  };
  
  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
  
  const renderLinkField = (field: Field) => {
    const value = formData[field.id] || "";
    if (typeof value === 'string' && value.startsWith('node://')) {
      const nodeId = value.substring(7);
      const linkedNodeInfo = findNodeAndParent(nodeId);
      return (
        <div className="flex items-center gap-2">
          <Input 
            value={value} 
            onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} 
          />
          <Button 
            type="button"
            variant="outline" 
            size="sm"
            disabled={!linkedNodeInfo}
            onClick={() => {
              onClose(); // Close the current edit dialog first
              setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [nodeId] });
            }}
          >
            <Link className="mr-2 h-4 w-4" /> Go to Node
          </Button>
        </div>
      );
    }
    return <Input type="url" placeholder="https://example.com" value={value} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}/>;
  };
  
  const handleDataChange = (fieldId: string, value: any) => {
    setFormData(prev => ({...prev, [fieldId]: value}));
  }

  const { setIgnoreClicksUntil } = useUIContext();

  const handleClose = (e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    setIgnoreClicksUntil(Date.now() + 100);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 p-1 max-h-[60vh] overflow-y-auto">
        {!isMultiEdit && node?.id && (node.createdAt || node.updatedAt) && (
             <div className="text-xs text-muted-foreground space-y-1">
                {node.createdAt && (
                    <p>Created: {formatDate(node.createdAt, `${currentUser?.dateFormat || 'dd/MM/yyyy'} p`)}</p>
                )}
                {node.updatedAt && (
                    <p>Last Modified: {formatDate(node.updatedAt, `${currentUser?.dateFormat || 'dd/MM/yyyy'} p`)}</p>
                )}
            </div>
        )}
        {isMultiEdit && (
            <div className="p-3 bg-accent/50 border border-accent rounded-md text-sm text-accent-foreground">
                You are editing {node?.id ? 1 : 'multiple'} nodes. Only the fields you fill out will be updated on the selected nodes.
            </div>
        )}
        {template.fields.map((field, fieldIndex) => {
          let renderedContent = null;
          switch(field.type) {
            case 'text':
              renderedContent = <Input value={formData[field.id] || ""} onChange={(e) => handleDataChange(field.id, e.target.value)} />;
              break;
            case 'textarea':
                renderedContent = <Textarea value={formData[field.id] || ""} onChange={(e) => handleDataChange(field.id, e.target.value)} />;
                break;
            case 'number':
              renderedContent = <Input type="number" value={formData[field.id] || ""} onChange={(e) => handleDataChange(field.id, e.target.value)} />;
              break;
            case 'date': {
                const dateString = formData[field.id];
                let dateValue: Date | undefined;
                if(dateString && typeof dateString === 'string') {
                  const parsedDate = parse(dateString, 'yyyy-MM-dd', new Date());
                  if (isValid(parsedDate)) dateValue = parsedDate;
                }
                renderedContent = <DatePicker date={dateValue} setDate={(d) => handleDataChange(field.id, d)} placeholder="Select a date" />;
              break;
            }
            case 'dropdown':
              renderedContent = (
                <Select value={formData[field.id]} onValueChange={(value) => handleDataChange(field.id, value)}>
                  <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
                  <SelectContent>{(field.options || []).filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              );
              break;
            case 'dynamic-dropdown':
              renderedContent = (
                <Combobox
                  options={getDynamicOptions(field.id, template.id)}
                  value={formData[field.id] || ""}
                  onChange={(value) => handleDataChange(field.id, value)}
                  placeholder={`Select ${field.name}...`}
                  searchPlaceholder={`Search ${field.name}...`}
                  emptyPlaceholder={`No ${field.name} found.`}
                />
              );
              break;
            case 'link':
              renderedContent = renderLinkField(field);
              break;
            case 'picture': {
              const currentImages = formData[field.id] ? (Array.isArray(formData[field.id]) ? formData[field.id] : [formData[field.id]]) : [];
              renderedContent = (
                  <div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleImageDragEnd(e, field.id)}>
                        <SortableContext items={currentImages} strategy={rectSortingStrategy}>
                          {currentImages.length > 0 && (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mb-2">
                              {currentImages.map((imgSrc: string) => (
                                <DraggableImage key={imgSrc} id={imgSrc} src={imgSrc} onRemove={() => handleRemoveImage(field.id, currentImages.indexOf(imgSrc))} onDoubleClick={() => window.open(imgSrc, '_blank')} />
                              ))}
                            </div>
                          )}
                        </SortableContext>
                      </DndContext>
                    <div 
                      className={cn("p-4 border-2 border-dashed rounded-lg text-center transition-colors", dragOverStates[field.id] ? "border-primary bg-accent" : "border-border", uploadingStates[field.id] && "border-solid" )}
                      onDrop={(e) => handleDrop(e, field)} onDragOver={handleDragOver} onDragEnter={(e) => handleDragEnter(e, field.id)} onDragLeave={(e) => handleDragLeave(e, field.id)}
                    >
                      {uploadingStates[field.id] ? (
                        <div className="flex flex-col items-center justify-center gap-2 p-4">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="text-muted-foreground">Uploading...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <ImagePlus className="h-8 w-8 text-muted-foreground" />
                          <p className="text-muted-foreground">Drag & drop images, paste an image, or enter a URL.</p>
                          <div className="flex items-center gap-2 w-full">
                            <Textarea id={`picture-url-${field.id}`} placeholder="Paste URL or image" value={""} onChange={(e) => { e.target.value = '' }} onPaste={(e) => handlePicturePaste(e, field.id)} rows={1} className="text-xs" />
                            <span className="text-xs text-muted-foreground">OR</span>
                            <Button type="button" variant="outline" onClick={() => fileInputRefs.current[field.id]?.click()}> <Upload className="mr-2 h-4 w-4" /> Select Files </Button>
                          </div>
                        </div>
                      )}
                      <input type="file" accept="image/*,image/tiff,image/bmp" multiple ref={(el) => { fileInputRefs.current[field.id] = el; }} onChange={(e) => handleFileInputChange(e, field)} className="hidden" />
                    </div>
                  </div>
              )
              break;
            }
             case 'attachment': {
                const currentAttachments: AttachmentInfo[] = formData[field.id] || [];
                renderedContent = (
                  <div>
                    {currentAttachments.length > 0 && (
                      <div className="space-y-2 mb-2">
                        {currentAttachments.map((att: AttachmentInfo, index: number) => (
                          <div key={index} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <FileIcon className="h-5 w-5 text-muted-foreground shrink-0"/>
                                <div className="flex-1 overflow-hidden">
                                    <p className="text-sm font-medium truncate">{att.name}</p>
                                    <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p>
                                </div>
                            </div>
                            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive h-7 w-7" onClick={() => handleRemoveAttachment(field.id, index)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={cn("p-4 border-2 border-dashed rounded-lg text-center transition-colors", dragOverStates[field.id] ? "border-primary bg-accent" : "border-border", uploadingStates[field.id] && "border-solid")}
                      onDrop={(e) => handleDrop(e, field)} onDragOver={handleDragOver} onDragEnter={(e) => handleDragEnter(e, field.id)} onDragLeave={(e) => handleDragLeave(e, field.id)} >
                      {uploadingStates[field.id] ? (
                        <div className="flex flex-col items-center justify-center gap-2 p-4"> <Loader2 className="h-8 w-8 animate-spin text-primary" /> <p className="text-muted-foreground">Uploading...</p> </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <Paperclip className="h-8 w-8 text-muted-foreground" />
                          <p className="text-muted-foreground">Drag & drop files here</p>
                          <div className="flex items-center gap-2 w-full"> <div className="flex-grow border-b"/> <span className="text-xs text-muted-foreground">OR</span> <div className="flex-grow border-b"/> </div>
                          <Button type="button" variant="outline" onClick={() => fileInputRefs.current[field.id]?.click()}> <Upload className="mr-2 h-4 w-4" /> Select Files </Button>
                        </div>
                      )}
                      <input type="file" multiple ref={(el) => { fileInputRefs.current[field.id] = el; }} onChange={(e) => handleFileInputChange(e, field)} className="hidden" />
                    </div>
                  </div>
                );
                break;
            }
            case 'xy-chart': {
              const chartData: XYChartData = { points: [], ...formData[field.id] };
              renderedContent = (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"> <Label htmlFor={`${field.id}-x-label`} className="text-xs">X-Axis Label</Label> <Input id={`${field.id}-x-label`} placeholder="e.g., Time (s)" value={chartData.xAxisLabel || ''} onChange={e => handleChartDataChange(field.id, 0, 'xAxisLabel', e.target.value)} /></div>
                    <div className="space-y-2"> <Label htmlFor={`${field.id}-y-label`} className="text-xs">Y-Axis Label</Label> <Input id={`${field.id}-y-label`} placeholder="e.g., Temperature (°C)" value={chartData.yAxisLabel || ''} onChange={e => handleChartDataChange(field.id, 0, 'yAxisLabel', e.target.value)} /></div>
                  </div>
                  <div className="space-y-2">
                    {chartData.points.map((dataPoint, index) => (
                      <Card key={index} className="bg-muted/50 p-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs w-8">X:</Label> <Input type="number" value={dataPoint.x} onChange={e => handleChartDataChange(field.id, index, 'x', e.target.value)} className="h-8" />
                          <Label className="text-xs w-8">Y:</Label> <Input type="number" value={dataPoint.y} onChange={e => handleChartDataChange(field.id, index, 'y', e.target.value)} className="h-8" />
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveChartRow(field.id, index)}> <Trash2 className="h-4 w-4"/> </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleAddChartRow(field.id)} className="mt-2"><PlusCircle className="mr-2 h-4 w-4"/> Add Data Point</Button>
                </div>
              );
              break;
            }
          }

          if (field.type === 'checkbox') {
            return (
              <div key={field.id} className="space-y-2">
                <div className="flex items-center space-x-2 pt-2 h-10">
                  <Checkbox id={`form-${field.id}`} checked={!!formData[field.id]} onCheckedChange={(checked) => handleDataChange(field.id, !!checked)} />
                  <Label htmlFor={`form-${field.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{field.name}</Label>
                </div>
              </div>
            );
          }
          if (field.type === 'checklist') {
            const items: ChecklistItem[] = formData[field.id] || [];
            return (
              <div key={field.id} className="space-y-2">
                <Label className="text-sm font-medium">{field.name}</Label>
                <div className="space-y-2">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => {
                    const { active, over } = event;
                    if (over && active.id !== over.id) {
                      const oldIndex = items.findIndex(item => item.id === active.id);
                      const newIndex = items.findIndex(item => item.id === over.id);
                      if (oldIndex !== -1 && newIndex !== -1) {
                        handleDataChange(field.id, arrayMove(items, oldIndex, newIndex));
                      }
                    }
                  }}>
                    <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                      {items.map((item, index) => (
                        <DraggableCheckboxItem key={item.id} id={item.id}>
                          <div className="flex items-center gap-2 w-full">
                            <Checkbox checked={item.checked} onCheckedChange={(checked) => {
                                const newItems = [...items]; newItems[index] = { ...item, checked: !!checked }; handleDataChange(field.id, newItems);
                            }} />
                            <Input value={item.text} onChange={(e) => {
                                const newItems = [...items]; newItems[index] = { ...item, text: e.target.value }; handleDataChange(field.id, newItems);
                            }} className="h-8" />
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDataChange(field.id, items.filter((_, i) => i !== index))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </DraggableCheckboxItem>
                      ))}
                    </SortableContext>
                  </DndContext>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleDataChange(field.id, [...items, { id: generateClientSideId(), text: '', checked: false }])} className="mt-2">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Item
                  </Button>
                </div>
              </div>
            );
          }
          if (field.type === 'query') {
              const handleQueryChange = (value: any) => handleDataChange(field.id, value);
              return <QueryBuilder key={field.id} field={field} value={formData[field.id]} onChange={handleQueryChange} />;
          }
           if (field.type === 'table-header') {
              if (fieldIndex > 0 && template.fields[fieldIndex - 1].type === 'table-header') return null;
              
              const tableRowCount = getTableRowCount();
              return (
                  <div key="table-block" className="space-y-2">
                      <Label className="text-sm font-medium">Table Data</Label>
                      <div className="space-y-4">
                          {Array.from({ length: tableRowCount }).map((_, rowIndex) => (
                              <Card key={rowIndex} className="bg-muted/50">
                                <CardContent className="p-4 space-y-4">
                                  <div className="flex justify-between items-center"><p className="font-semibold">Row {rowIndex + 1}</p>
                                    <AlertDialog><AlertDialogTrigger asChild>
                                      <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive h-8 w-8"><Trash2 className="h-4 w-4" /></Button>
                                    </AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the entire row.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRemoveRow(rowIndex)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                                  </div>
                                  {tableHeaderFields.map(field => {
                                    const dateString = formData[field.id]?.[rowIndex]; let dateValue: Date | undefined;
                                    if (dateString && typeof dateString === 'string') { const parsed = parse(dateString, 'yyyy-MM-dd', new Date()); if (isValid(parsed)) dateValue = parsed; }
                                    return (
                                      <div key={`${field.id}-${rowIndex}`} className="space-y-2"><Label className="text-sm font-medium">{field.name}</Label>
                                        <div className="flex items-center gap-1">
                                          {field.prefix && <span className="text-muted-foreground text-sm">{field.prefix}</span>}
                                          {field.columnType === 'date' ? (<DatePicker date={dateValue} setDate={(d) => handleTableChange(rowIndex, field.id, d)} placeholder="Select a date" />) : (<Input type={field.columnType || 'text'} value={formData[field.id]?.[rowIndex] || ''} onChange={e => handleTableChange(rowIndex, field.id, e.target.value)} className="h-8 flex-grow" />)}
                                          {field.postfix && <span className="text-muted-foreground text-sm">{field.postfix}</span>}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </CardContent>
                              </Card>
                          ))}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddRow} className="mt-2"><PlusCircle className="mr-2 h-4 w-4"/> Add Row</Button>
                  </div>
              );
          }
          if (renderedContent) {
            return (
              <div key={field.id} className="space-y-2">
                  <Label className="text-sm font-medium">{field.name}</Label>
                  <div className="flex items-center gap-1">
                    {field.prefix && <span className="text-muted-foreground text-sm">{field.prefix}</span>}
                    <div className="flex-grow">{renderedContent}</div>
                    {field.postfix && <span className="text-muted-foreground text-sm">{field.postfix}</span>}
                  </div>
              </div>
            );
          }
          return null;
        })}
      </div>
      
      <DialogFooter className="mt-4">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit">{isMultiEdit ? `Update ${node?.id ? 1 : 'nodes'}` : 'Save'}</Button>
      </DialogFooter>
    </form>
  );
};


const QueryBuilder = ({ field, value, onChange }: { field: Field, value: any, onChange: (value: any) => void }) => {
    const { getTemplateById, templates } = useTreeContext();
    const queryDefs: QueryDefinition[] = Array.isArray(value) ? value : [];

    const handleQueryChange = (newDefs: QueryDefinition[]) => {
      onChange(newDefs);
    };

    const handleQueryGroupChange = (queryIndex: number, key: keyof Omit<QueryDefinition, 'id'>, value: any) => {
        const newQueryDefs = [...queryDefs];
        newQueryDefs[queryIndex] = { ...newQueryDefs[queryIndex], [key]: value };
        handleQueryChange(newQueryDefs);
    };

    const handleRuleChange = (queryIndex: number, ruleIndex: number, key: keyof QueryRule, value: any) => {
        const newQueryDefs = [...queryDefs];
        const newRules = [...newQueryDefs[queryIndex].rules];
        newRules[ruleIndex] = { ...newRules[ruleIndex], [key]: value };
        if (key === 'type') {
            if (value === 'field') {
                delete newRules[ruleIndex].relationTemplateId;
                delete newRules[ruleIndex].relationRules;
            } else {
                delete newRules[ruleIndex].fieldId;
                delete newRules[ruleIndex].operator;
                delete newRules[ruleIndex].value;
            }
        }
        handleQueryGroupChange(queryIndex, 'rules', newRules);
    };

    const addQueryGroup = () => {
        handleQueryChange([...queryDefs, { id: generateClientSideId(), targetTemplateId: null, rules: [] }]);
    };
    
    const removeQueryGroup = (queryIndex: number) => {
        handleQueryChange(queryDefs.filter((_, index) => index !== queryIndex));
    };

    const addRule = (queryIndex: number) => {
        const newRules = [...(queryDefs[queryIndex].rules || []), { id: generateClientSideId(), type: 'field', fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
        handleQueryGroupChange(queryIndex, 'rules', newRules);
    };

    const removeRule = (queryIndex: number, ruleIndex: number) => {
        const newRules = (queryDefs[queryIndex].rules || []).filter((_, index) => index !== ruleIndex);
        handleQueryGroupChange(queryIndex, 'rules', newRules);
    };
    
    const handleRelationRuleChange = (queryIndex: number, ruleIndex: number, relationRuleIndex: number, key: keyof SimpleQueryRule, value: any) => {
      const newQueryDefs = [...queryDefs];
      const newRules = [...newQueryDefs[queryIndex].rules];
      const newRelationRules = [...(newRules[ruleIndex].relationRules || [])];
      newRelationRules[relationRuleIndex] = { ...newRelationRules[relationRuleIndex], [key]: value };
      newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
      handleQueryGroupChange(queryIndex, 'rules', newRules);
    };

    const addRelationRule = (queryIndex: number, ruleIndex: number) => {
      const newQueryDefs = [...queryDefs];
      const newRules = [...newQueryDefs[queryIndex].rules];
      const newRelationRules = [...(newRules[ruleIndex].relationRules || []), { id: generateClientSideId(), fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
      newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
      handleQueryGroupChange(queryIndex, 'rules', newRules);
    };

    const removeRelationRule = (queryIndex: number, ruleIndex: number, relationRuleIndex: number) => {
        const newQueryDefs = [...queryDefs];
        const newRules = [...newQueryDefs[queryIndex].rules];
        const newRelationRules = (newRules[ruleIndex].relationRules || []).filter((_, index) => index !== relationRuleIndex);
        newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
        handleQueryGroupChange(queryIndex, 'rules', newRules);
    };

    return (
        <div key={field.id} className="space-y-2">
          <Label className="text-sm font-medium">{field.name}</Label>
          <div className="space-y-4">
            {queryDefs.map((queryDef, queryIndex) => {
              const targetTemplate = templates.find(t => t.id === queryDef.targetTemplateId);
              return (
                  <Card key={queryDef.id || queryIndex} className="bg-muted/50 p-4 space-y-4">
                      <div className="flex justify-between items-center">
                          <Label>Search for nodes with template:</Label>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeQueryGroup(queryIndex)}>
                              <Trash2 className="h-4 w-4"/>
                          </Button>
                      </div>
                      <Select value={queryDef.targetTemplateId || ''} onValueChange={(val) => handleQueryGroupChange(queryIndex, 'targetTemplateId', val)}>
                          <SelectTrigger><SelectValue placeholder="Select a template..."/></SelectTrigger>
                          <SelectContent>
                              {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                          </SelectContent>
                      </Select>
                      
                      <div className="space-y-2">
                           <Label>Where...</Label>
                           {(queryDef.rules || []).map((rule, ruleIndex) => {
                                const ruleType = rule.type || 'field';
                                const relationTemplate = rule.relationTemplateId ? getTemplateById(rule.relationTemplateId) : null;
                                return (
                                    <Card key={rule.id || ruleIndex} className="p-2 bg-background space-y-2">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Select value={ruleType} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'type', val)}>
                                                    <SelectTrigger className="w-auto"><SelectValue/></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="field">Field</SelectItem>
                                                        <SelectItem value="ancestor">Ancestor</SelectItem>
                                                        <SelectItem value="descendant">Descendant</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRule(queryIndex, ruleIndex)}>
                                                    <Trash2 className="h-4 w-4"/>
                                                </Button>
                                            </div>
                                            {ruleType === 'field' ? (
                                                <div className="space-y-2 pl-2">
                                                    <Select value={rule.fieldId || ''} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'fieldId', val)} disabled={!targetTemplate}>
                                                        <SelectTrigger><SelectValue placeholder="Field..."/></SelectTrigger>
                                                        <SelectContent>
                                                            {targetTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <Select value={rule.operator || 'equals'} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'operator', val)}>
                                                        <SelectTrigger><SelectValue placeholder="Operator..."/></SelectTrigger>
                                                        <SelectContent>
                                                            {Object.entries(operatorLabels).map(([op, label]) => <SelectItem key={op} value={op}>{label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <Input value={rule.value || ''} onChange={(e) => handleRuleChange(queryIndex, ruleIndex, 'value', e.target.value)} placeholder="Value..."/>
                                                </div>
                                            ) : (
                                                <div className="space-y-2 pl-2">
                                                   <span className="text-sm p-2 block">has {ruleType} with template:</span>
                                                    <Select value={rule.relationTemplateId || ''} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'relationTemplateId', val)}>
                                                        <SelectTrigger><SelectValue placeholder="Template..."/></SelectTrigger>
                                                        <SelectContent>
                                                            {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        </div>
                                        { (ruleType === 'ancestor' || ruleType === 'descendant') && rule.relationTemplateId && (
                                            <div className="pl-6 space-y-2">
                                                <Label className="text-xs text-muted-foreground">Where...</Label>
                                                {(rule.relationRules || []).map((relRule, relRuleIndex) => (
                                                    <Card key={relRule.id} className="p-2 bg-muted/50">
                                                        <div className="space-y-2">
                                                            <Select value={relRule.fieldId} onValueChange={(val) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'fieldId', val)}>
                                                                <SelectTrigger><SelectValue placeholder="Field..." /></SelectTrigger>
                                                                <SelectContent>{relationTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                                                            </Select>
                                                            <Select value={relRule.operator} onValueChange={(val) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'operator', val)}>
                                                                <SelectTrigger><SelectValue placeholder="Operator..."/></SelectTrigger>
                                                                <SelectContent>
                                                                    {Object.entries(operatorLabels).map(([op, label]) => <SelectItem key={op} value={op}>{label}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                                                            <Input value={relRule.value} onChange={(e) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'value', e.target.value)} placeholder="Value..."/>
                                                            <div className="flex justify-end">
                                                                <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRelationRule(queryIndex, ruleIndex, relRuleIndex)}>
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </Card>
                                                ))}
                                                <Button type="button" variant="outline" size="sm" onClick={() => addRelationRule(queryIndex, ruleIndex)}>
                                                    <PlusCircle className="mr-2 h-4 w-4" /> Add condition for {ruleType}
                                                </Button>
                                            </div>
                                        )}
                                    </Card>
                                )
                           })}
                          <Button type="button" variant="outline" size="sm" onClick={() => addRule(queryIndex)} disabled={!targetTemplate}>
                              <PlusCircle className="mr-2 h-4 w-4"/> Add AND Condition
                          </Button>
                      </div>
                  </Card>
              )
            })}
            <Button type="button" variant="outline" className="w-full" onClick={addQueryGroup}>
              <PlusCircle className="mr-2 h-4 w-4"/> Add OR Condition
            </Button>
          </div>
        </div>
    );
};
