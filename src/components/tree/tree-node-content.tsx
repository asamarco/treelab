

/**
 * @fileoverview
 * This component renders the collapsible content area of a tree node.
 * It displays complex fields like image carousels, attachment lists, and tables,
 * as well as the formatted body text and recursively rendered child nodes.
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { TreeNode, Template, AttachmentInfo } from "@/lib/types";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Card, CardContent } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { RenderWithLinks } from "./render-with-links";
import { Icon } from "../icon";
import { Download, Grid, Rows } from "lucide-react";
import { TreeNodeComponent } from "./tree-node";
import { formatBytes, formatDate } from "@/lib/utils";
import { useAuthContext } from "@/contexts/auth-context";
import { TreeNodeDropZone } from "./tree-node-dropzone";
import { SetStateAction } from "react";
import type { WritableDraft } from "immer";
import { Button } from "../ui/button";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";


interface TreeNodeContentProps {
  node: TreeNode;
  template: Template;
  isExpanded: boolean;
  level: number;
  onSelect: (instanceId: string, isChecked: boolean, isShiftClick: boolean) => void;
  contextualParentId: string | null;
  overrideExpandedIds?: string[];
  onExpandedChange?: (updater: SetStateAction<string[]> | ((draft: WritableDraft<string[]>) => void | WritableDraft<string[]>)) => void;
}

export function TreeNodeContent({ node, template, isExpanded, level, onSelect, contextualParentId, overrideExpandedIds, onExpandedChange }: TreeNodeContentProps) {
  const { currentUser } = useAuthContext();
  const nodeData = node.data || {}; // Ensure node.data is an object
  const [imageViewModes, setImageViewModes] = useState<Record<string, 'carousel' | 'grid'>>({});
  const [containerWidths, setContainerWidths] = useState<Record<string, number>>({});
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!isExpanded) return;

    const observers: Record<string, ResizeObserver> = {};
    const currentRefs = containerRefs.current;

    for (const fieldId in currentRefs) {
      const element = currentRefs[fieldId];
      if (element) {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            setContainerWidths(prev => ({ ...prev, [fieldId]: entry.contentRect.width }));
          }
        });
        observer.observe(element);
        observers[fieldId] = observer;
      }
    }

    return () => {
      for (const fieldId in observers) {
        observers[fieldId].disconnect();
      }
    };
  }, [template.fields, isExpanded]);


  const handleImageDoubleClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    window.open(url, '_blank');
  };

  const pictureFields = template.fields.filter((f) => f.type === 'picture');
  const attachmentFields = template.fields.filter((f) => f.type === 'attachment');
  const tableHeaderFields = template.fields.filter(f => f.type === 'table-header');
  
  const getTableRowCount = () => {
    if (tableHeaderFields.length === 0) return 0;
    const firstColumnData = nodeData[tableHeaderFields[0].id];
    return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
  };

  if (!isExpanded) {
    return null;
  }

  return (
    <CollapsibleContent>
      <div className="pt-2 pl-6">
        {template.bodyTemplate && (
          <div className="text-sm text-foreground/90 whitespace-pre-wrap pt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <RenderWithLinks node={node} template={template} text={template.bodyTemplate} />
          </div>
        )}
        {pictureFields.map((field) => {
          let value = nodeData[field.id];
          if (!value || (Array.isArray(value) && value.length === 0)) return null;

          if (typeof value === 'string') value = [value];
          if (!Array.isArray(value)) return null;

          const images = value.filter(v => typeof v === 'string' && v.length > 0);
          if (images.length === 0) return null;
          
          const imageWidth = field.width || 300;
          const containerWidth = containerWidths[field.id] || 0;
          const totalImageWidth = images.length * (imageWidth + 8); // width + gap
          const doesOverflow = containerWidth > 0 && totalImageWidth > containerWidth;

          const viewMode = imageViewModes[field.id] || 'carousel';
          const finalViewMode = doesOverflow ? viewMode : 'grid';

          return (
            <div 
              key={field.id} 
              className="mt-2" 
              onClick={(e) => e.stopPropagation()} 
              onDoubleClick={(e) => e.stopPropagation()}
              ref={el => { containerRefs.current[field.id] = el; }}
            >
              <div className="flex justify-between items-center mb-1">
                 <p className="font-medium text-sm">{field.name}</p>
                 {doesOverflow && images.length > 1 && (
                    <TooltipProvider>
                      <div className="flex items-center gap-1 rounded-full p-1 bg-muted">
                          <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant={viewMode === 'carousel' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 rounded-full" onClick={() => setImageViewModes(prev => ({...prev, [field.id]: 'carousel'}))}>
                                    <Rows className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Slideshow View</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                              <TooltipTrigger asChild>
                                  <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 rounded-full" onClick={() => setImageViewModes(prev => ({...prev, [field.id]: 'grid'}))}>
                                      <Grid className="h-4 w-4" />
                                  </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Grid View</p></TooltipContent>
                          </Tooltip>
                      </div>
                    </TooltipProvider>
                 )}
              </div>
              
              {finalViewMode === 'carousel' ? (
                 <div className="mx-auto" style={{ maxWidth: '100%' }}>
                  <Carousel className="w-full" opts={{ loop: images.length > 1, align: "start" }}>
                    <CarouselContent>
                      {images.map((src, index) => (
                        <CarouselItem key={index} style={{ flexBasis: `${imageWidth}px` }}>
                          <div className="p-1 h-full flex items-center justify-center">
                              <CardContent className="flex h-full items-center justify-center p-0 overflow-hidden rounded-lg">
                                <img src={src} alt={`${field.name} ${index + 1}`} className="max-w-full max-h-full h-auto object-contain" onDoubleClick={(e) => handleImageDoubleClick(e, src)} />
                              </CardContent>
                          </div>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    {images.length > 1 && <>
                        <CarouselPrevious />
                        <CarouselNext />
                    </>}
                  </Carousel>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 items-center justify-center">
                    {images.map((src, index) => (
                        <div key={index} className="flex items-center justify-center" style={{ flexBasis: `${imageWidth}px`, maxWidth: `${imageWidth}px` }}>
                             <img src={src} alt={`${field.name} ${index + 1}`} className="max-w-full max-h-full object-contain rounded-md" onDoubleClick={(e) => handleImageDoubleClick(e, src)} />
                        </div>
                    ))}
                </div>
              )}
            </div>
          )
        })}
        {attachmentFields.map(field => {
          const attachments: AttachmentInfo[] = nodeData[field.id];
          if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;

          return (
            <div key={field.id} className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <p className="font-medium mb-1 text-sm">{field.name}</p>
              <div className="space-y-2">
                {attachments.map((att, index) => {
                  const fullUrl = `${att.path}?name=${encodeURIComponent(att.name)}`;
                  return (
                    <a key={index} href={fullUrl} download={att.name} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <Icon name="File" className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-medium truncate">{att.name}</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p>
                        </div>
                      </div>
                      <Download className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })}
        {tableHeaderFields.length > 0 && (
          <div className="mt-2 text-sm" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <p className="font-medium mb-1">Table</p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {tableHeaderFields.map(field => <TableHead key={field.id}>{field.name}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: getTableRowCount() }).map((_, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {tableHeaderFields.map(field => {
                        let cellValue = nodeData[field.id]?.[rowIndex] || '';
                        let displayValue = cellValue;

                        if (field.columnType === 'date' && cellValue) {
                           displayValue = formatDate(cellValue, currentUser?.dateFormat);
                        }
                        
                        if (displayValue) {
                          displayValue = `${field.prefix || ''}${displayValue}${field.postfix || ''}`;
                        }
                        
                        return (
                          <TableCell key={field.id}>{displayValue}</TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
      {node.children.length > 0 && node.children.map((childNode, childIndex) => (
        <div key={`${childNode.id}_${node.id}`}>
            <TreeNodeDropZone id={`gap_${childNode.id}_${node.id}`} />
            <TreeNodeComponent
              node={childNode}
              level={level + 1}
              siblings={node.children}
              onSelect={onSelect}
              contextualParentId={node.id}
              overrideExpandedIds={overrideExpandedIds}
              onExpandedChange={onExpandedChange as any}
            />
        </div>
      ))}
    </CollapsibleContent>
  );
}
