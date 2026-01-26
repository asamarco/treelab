

/**
 * @fileoverview
 * This component renders the collapsible content area of a tree node.
 * It displays complex fields like image carousels, attachment lists, and tables,
 * as well as the formatted body text and recursively rendered child nodes.
 */
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { TreeNode, Template, AttachmentInfo, XYChartData, QueryDefinition } from "@/lib/types";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Card, CardContent } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { RenderWithLinks } from "./render-with-links";
import { Icon } from "../icon";
import { Download, Grid, Rows, Crosshair } from "lucide-react";
import { TreeNodeComponent } from "./tree-node";
import { formatBytes, formatDate } from "@/lib/utils";
import { useAuthContext } from "@/contexts/auth-context";
import { TreeNodeDropZone } from "./tree-node-dropzone";
import { SetStateAction } from "react";
import type { WritableDraft } from "immer";
import { Button } from "../ui/button";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Label, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { getConditionalStyle } from "./tree-node-utils";
import { useToast } from "@/hooks/use-toast";

interface TreeNodeContentProps {
  node: TreeNode;
  template: Template;
  isExpanded: boolean;
  level: number;
  onSelect: (instanceId: string, isChecked: boolean, isShiftClick: boolean) => void;
  contextualParentId: string | null;
  overrideExpandedIds?: string[];
  onExpandedChange?: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
}

export function TreeNodeContent({ node, template, isExpanded, level, onSelect, contextualParentId, overrideExpandedIds, onExpandedChange }: TreeNodeContentProps) {
  const { currentUser } = useAuthContext();
  const { findNodesByQuery, getTemplateById, setSelectedNodeIds, findNodeAndParent, expandToNode } = useTreeContext();
  const { setDialogState } = useUIContext();
  const { toast } = useToast();
  const nodeData = node.data || {}; // Ensure node.data is an object
  const [imageViewModes, setImageViewModes] = useState<Record<string, 'carousel' | 'grid'>>({});
  const [containerWidths, setContainerWidths] = useState<Record<string, number>>({});
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number, height: number }>>({});


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
  const xyChartFields = template.fields.filter(f => f.type === 'xy-chart');
  const queryFields = template.fields.filter(f => f.type === 'query');
  
  const getTableRowCount = () => {
    if (tableHeaderFields.length === 0) return 0;
    const firstColumnData = nodeData[tableHeaderFields[0].id];
    return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
  };
  
  const queriesAndResults = useMemo(() => {
    return queryFields.map(field => {
        const queryDefinitions = nodeData[field.id];
        if (!Array.isArray(queryDefinitions) || queryDefinitions.length === 0) {
            return { field, results: null };
        }

        const combinedResults = new Map<string, TreeNode>();
        
        queryDefinitions.forEach((queryDef: QueryDefinition) => {
            if (queryDef && queryDef.targetTemplateId) {
                const results = findNodesByQuery(queryDef);
                results.forEach(node => combinedResults.set(node.id, node));
            }
        });

        return { field, results: Array.from(combinedResults.values()) };
    });
  }, [queryFields, nodeData, findNodesByQuery]);

  if (!isExpanded) {
    return null;
  }

  return (
    <CollapsibleContent>
      <div className="pt-2 pl-6" onClick={(e) => e.stopPropagation()}>
        {template.bodyTemplate && (
          <div className="text-sm text-foreground/90 whitespace-pre-wrap pt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <RenderWithLinks node={node} template={template} text={template.bodyTemplate} />
          </div>
        )}
        {xyChartFields.map((field) => {
            const chartData: XYChartData = nodeData[field.id];
            if (!chartData || !Array.isArray(chartData.points) || chartData.points.length === 0) {
              return null;
            }
            // Ensure data is numeric
            const numericData = chartData.points.map(d => ({ ...d, x: Number(d.x), y: Number(d.y) })).filter(d => !isNaN(d.x) && !isNaN(d.y));

            if(numericData.length === 0) return null;

            return (
              <div key={field.id} className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                 <p className="font-medium text-sm mb-2">{field.name}</p>
                 <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <LineChart data={numericData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']}>
                           <Label value={chartData.xAxisLabel} offset={-15} position="insideBottom" />
                        </XAxis>
                        <YAxis domain={['auto', 'auto']}>
                           <Label value={chartData.yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
                        </YAxis>
                        <ChartTooltip />
                        <Line type="monotone" dataKey="y" stroke="hsl(var(--primary))" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                 </div>
              </div>
            )
        })}
        {pictureFields.map((field) => {
          let value = nodeData[field.id];
          if (!value || (Array.isArray(value) && value.length === 0)) return null;

          if (typeof value === 'string') value = [value];
          if (!Array.isArray(value)) return null;

          const images = value.filter(v => typeof v === 'string' && v.length > 0);
          if (images.length === 0) return null;
          
          const maxHeight = field.height || 300;
          const containerWidth = containerWidths[field.id] || 0;
          
          // Calculate the total width of all images based on their actual aspect ratios
          const totalImageWidth = images.reduce((acc, src) => {
              const dims = imageDimensions[src];
              if (!dims || dims.height === 0) {
                  // Fallback for images not yet loaded or with zero height
                  return acc + (maxHeight * (4/3)) + 8; // (width estimate + gap)
              }
              const renderedWidth = (dims.width / dims.height) * maxHeight;
              return acc + renderedWidth + 8; // (actual rendered width + gap)
          }, 0);

          const indentation = level * 24; // Each level adds 24px of indentation (pl-6)
          const doesOverflow = containerWidth > 0 && totalImageWidth > (containerWidth - indentation - 50);

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
                      {images.map((src, index) => {
                          const dims = imageDimensions[src];
                          let height = maxHeight;
                          if (dims && dims.height < maxHeight) {
                            height = dims.height;
                          }
                          return (
                            <CarouselItem key={index} style={{ flexBasis: `auto` }}>
                                <div className="p-1 h-full flex items-center justify-center">
                                    <CardContent className="flex h-full items-center justify-center p-0 overflow-hidden rounded-lg">
                                        <img 
                                          src={src} 
                                          alt={`${field.name} ${index + 1}`} 
                                          className="object-contain w-auto h-full"
                                          style={{ height: `${height}px` }} 
                                          onDoubleClick={(e) => handleImageDoubleClick(e, src)} 
                                          onLoad={(e) => {
                                            const img = e.currentTarget;
                                            setImageDimensions(prev => ({ ...prev, [src]: { width: img.naturalWidth, height: img.naturalHeight } }));
                                          }}
                                        />
                                    </CardContent>
                                </div>
                            </CarouselItem>
                          );
                      })}
                    </CarouselContent>
                    {images.length > 1 && <>
                        <CarouselPrevious />
                        <CarouselNext />
                    </>}
                  </Carousel>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 items-center justify-center">
                    {images.map((src, index) => {
                        const dims = imageDimensions[src];
                        let height = maxHeight;
                        if (dims && dims.height < maxHeight) {
                          height = dims.height;
                        }
                        return (
                            <div key={index} className="flex items-center justify-center" style={{ height: `${height}px` }}>
                                 <img 
                                    src={src} 
                                    alt={`${field.name} ${index + 1}`} 
                                    className="object-contain max-w-full h-full rounded-md"
                                    onDoubleClick={(e) => handleImageDoubleClick(e, src)}
                                    onLoad={(e) => {
                                      const img = e.currentTarget;
                                      setImageDimensions(prev => ({ ...prev, [src]: { width: img.naturalWidth, height: img.naturalHeight } }));
                                    }}
                                  />
                            </div>
                        );
                    })}
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
        
        {queriesAndResults.map(({ field, results }) => {
          if (!results) return null;
          return (
            <div key={field.id} className="mt-4 space-y-1 pt-2">
              <p className="font-medium text-sm mb-1">{field.name}</p>
              {results.length > 0 ? (
                results.map(resultNode => {
                  const resultTemplate = getTemplateById(resultNode.templateId);
                  const { icon, color } = getConditionalStyle(resultNode, resultTemplate);
                  return (
                    <div key={resultNode.id} className="flex items-center justify-between gap-2 p-1.5 -ml-1.5 rounded-md hover:bg-accent group/queryresult">
                        <div className="flex items-center gap-2 overflow-hidden flex-grow">
                            <div
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={(e) => {
                                e.stopPropagation();
                                setDialogState({ isNodePreviewOpen: true, nodeIdsForPreview: [resultNode.id] });
                                }}
                            >
                                <Icon name={icon as any} className="h-4 w-4 shrink-0" style={{ color: color }} />
                                <span className="font-medium text-sm truncate">{resultNode.name}</span>
                            </div>
                            <TooltipProvider>
                                <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0 opacity-0 group-hover/queryresult:opacity-100"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const nodeInfo = findNodeAndParent(resultNode.id);
                                        if (nodeInfo) {
                                        expandToNode(resultNode.id);
                                        
                                        const primaryParentId = nodeInfo.node.parentIds[0] || 'root';
                                        const instanceId = `${resultNode.id}_${primaryParentId}`;
                                        setSelectedNodeIds([instanceId]);
                                        
                                        setDialogState({ 
                                            isNodePreviewOpen: false, 
                                            isNodeEditOpen: false,
                                            isAddChildOpen: false,
                                            isAddSiblingOpen: false,
                                        });

                                        requestAnimationFrame(() => {
                                            const element = document.getElementById(`node-card-${instanceId}`);
                                            element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        });
                                        } else {
                                            toast({
                                                variant: 'destructive',
                                                title: 'Node not found',
                                                description: 'The target node could not be found in the current tree view.'
                                            });
                                        }
                                    }}
                                    >
                                    <Crosshair className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Locate node in tree</p>
                                </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground italic px-2 py-1">Query returned no results.</p>
              )}
            </div>
          );
        })}
        
        {node.children && node.children.length > 0 && (
          <div className="children-container mt-4 space-y-1 pt-2" onClick={(e) => e.stopPropagation()}>
              {node.children.map((childNode) => (
                <div key={`${childNode.id}_${node.id}`}>
                  <TreeNodeComponent
                    node={childNode}
                    level={level + 1}
                    siblings={node.children}
                    onSelect={onSelect}
                    contextualParentId={node.id}
                    overrideExpandedIds={overrideExpandedIds}
                    onExpandedChange={onExpandedChange}
                  />
                  <TreeNodeDropZone id={`gap_${childNode.id}_${node.id}`} />
                </div>
              ))}
          </div>
        )}
      </div>
    </CollapsibleContent>
  );
}
