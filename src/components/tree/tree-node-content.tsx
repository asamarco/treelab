/**
 * @fileoverview
 * This component renders the collapsible content area of a tree node.
 * It displays complex fields like image carousels, attachment lists, and tables,
 * as well as the formatted body text and recursively rendered child nodes.
 * It now reacts dynamically to the isCompactView state.
 */
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { TreeNode, Template, AttachmentInfo, XYChartData, QueryDefinition, ChecklistItem } from "@/lib/types";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { CardContent } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { RenderWithLinks } from "./render-with-links";
import { Icon } from "../icon";
import { Download, Grid, Rows, Crosshair, X } from "lucide-react";
import { TreeNodeComponent } from "./tree-node";
import { formatBytes, formatDate } from "@/lib/utils";
import { useAuthContext } from "@/contexts/auth-context";
import { TreeNodeDropZone } from "./tree-node-dropzone";
import { WritableDraft } from "immer";
import { Button } from "../ui/button";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Label as ChartLabel, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { useTreeContext } from "@/contexts/tree-context";
import { useUIContext } from "@/contexts/ui-context";
import { getConditionalStyle } from "./tree-node-utils";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";


interface TreeNodeContentProps {
    node: TreeNode;
    template: Template;
    isExpanded: boolean;
    level: number;
    onSelect: (instanceId: string, isChecked: boolean, isShiftClick: boolean) => void;
    contextualParentId: string | null;
    overrideExpandedIds?: string[];
    onExpandedChange?: (updater: (draft: WritableDraft<string[]>) => void | WritableDraft<string[]>, isUndoable?: boolean) => void;
    isCompactOverride?: boolean;
    isExplorer?: boolean;
    readOnly?: boolean;
    disableSelection?: boolean;
}

export function TreeNodeContent({ node, template, isExpanded, level, onSelect, contextualParentId, overrideExpandedIds, onExpandedChange, isCompactOverride, isExplorer, readOnly = false, disableSelection = false }: TreeNodeContentProps) {
    const { currentUser } = useAuthContext();
    const { findNodesByQuery, getTemplateById, setSelectedNodeIds, findNodeAndParent, expandToNode, updateNode } = useTreeContext();
    const { setDialogState, isCompactView: globalIsCompactView } = useUIContext();
    const isMobile = useIsMobile();
    const { toast } = useToast();

    const isCompactView = isCompactOverride ?? globalIsCompactView;

    const nodeData = node.data || {};
    const [imageViewModes, setImageViewModes] = useState<Record<string, 'carousel' | 'grid'>>({});
    const [containerWidths, setContainerWidths] = useState<Record<string, number>>({});
    const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number, height: number }>>({});
    const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

    let tableRendered = false;


    useEffect(() => {
        if (!isExpanded || isCompactOverride) return;

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
    }, [template.fields, isExpanded, isCompactOverride]);


    const handleCheckboxChange = (fieldId: string, itemId: string, checked: boolean) => {
        if (readOnly) return;
        const currentItems: ChecklistItem[] = node.data[fieldId] || [];
        const newItems = currentItems.map(item =>
            item.id === itemId ? { ...item, checked } : item
        );
        const newData = {
            ...node.data,
            [fieldId]: newItems,
        };
        if (updateNode) {
            updateNode(node.id, { data: newData });
        }
    };

    const tableHeaderFields = useMemo(() => template.fields.filter(f => f.type === 'table-header'), [template.fields]);

    const queryFields = useMemo(() => template.fields.filter(f => f.type === 'query'), [template.fields]);

    const tableRowCountMemo = useMemo(() => {
        if (tableHeaderFields.length === 0) return 0;
        const firstColumnData = nodeData[tableHeaderFields[0].id];
        return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
    }, [tableHeaderFields, nodeData]);

    const queriesAndResults = useMemo(() => {
        if (isCompactOverride) return [];
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

            const sortedResults = Array.from(combinedResults.values()).sort((a, b) =>
                (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })
            );

            return { field, results: sortedResults };
        });
    }, [queryFields, nodeData, findNodesByQuery, isCompactOverride]);

    if (!isExpanded) {
        return null;
    }

    const isHandleHidden = isMobile || readOnly || disableSelection || isExplorer;
    const showVerticalLines = isCompactView || isExplorer;
    const verticalLineClass = showVerticalLines ? "border-l border-border/50" : "";

    const leftMargin = showVerticalLines
        ? (isHandleHidden ? "ml-[13.5px]" : "ml-[43.5px]")
        : "ml-0";

    return (
        <CollapsibleContent className="min-w-0 w-full overflow-hidden">
            <div className={cn("min-w-0 w-full", isCompactView ? "pl-0 pt-0" : "pl-0 pt-2", isExplorer && "pt-0")} onClick={(e) => e.stopPropagation()}>
                <div className={cn("min-w-0 w-full transition-all pr-1 pb-1", verticalLineClass, leftMargin, isExplorer && "pb-0 pr-0")}>
                    {!isCompactOverride && (
                        <div className={cn("pl-3 pb-1 pr-1 min-w-0 w-full flex flex-col")}>
                            {template.bodyTemplate && (
                                <div className={cn("text-foreground/90 whitespace-pre-wrap pt-2", isCompactView ? "text-xs" : "text-sm")} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                    <RenderWithLinks node={node} template={template} text={template.bodyTemplate} />
                                </div>
                            )}

                            {template.fields.map((field) => {
                                const value = nodeData[field.id];

                                switch (field.type) {
                                    case 'checkbox': {
                                        const isChecked = !!value;
                                        return (
                                            <div key={field.id} className="mt-2 flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    id={`view-${node.id}-${field.id}`}
                                                    checked={isChecked}
                                                    disabled={readOnly}
                                                    onCheckedChange={(checked) => {
                                                        if (updateNode && !readOnly) {
                                                            updateNode(node.id, { data: { ...node.data, [field.id]: !!checked } });
                                                        }
                                                    }}
                                                />
                                                <Label htmlFor={`view-${node.id}-${field.id}`} className={cn("font-normal", isChecked && "text-muted-foreground", isCompactView && "text-xs")}>
                                                    {field.name}
                                                </Label>
                                            </div>
                                        );
                                    }
                                    case 'checklist': {
                                        const items: ChecklistItem[] = value || [];
                                        if (items.length === 0) return null;

                                        return (
                                            <div key={field.id} className="mt-4" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                <p className={cn("font-medium mb-2", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
                                                <div className="space-y-2">
                                                    {items.map(item => (
                                                        <div key={item.id} className="flex items-center gap-2">
                                                            <Checkbox
                                                                checked={item.checked}
                                                                disabled={readOnly}
                                                                onCheckedChange={(checked) => handleCheckboxChange(field.id, item.id, !!checked)}
                                                            />
                                                            <span className={cn(item.checked && "text-muted-foreground", isCompactView ? "text-xs" : "text-sm")}>
                                                                {item.text}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    }
                                    case 'xy-chart': {
                                        const chartData: XYChartData = value;
                                        if (!chartData || !Array.isArray(chartData.points) || chartData.points.length === 0) return null;
                                        const numericData = chartData.points.map(d => ({ ...d, x: Number(d.x), y: Number(d.y) })).filter(d => !isNaN(d.x) && !isNaN(d.y));

                                        if (numericData.length === 0) return null;

                                        return (
                                            <div key={field.id} className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                <p className={cn("font-medium mb-2", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
                                                <div style={{ width: '100%', height: isCompactView ? 180 : 300 }}>
                                                    <ResponsiveContainer>
                                                        <LineChart data={numericData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                                                            <CartesianGrid strokeDasharray="3 3" />
                                                            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']}>
                                                                <ChartLabel value={chartData.xAxisLabel} offset={-15} position="insideBottom" />
                                                            </XAxis>
                                                            <YAxis domain={['auto', 'auto']}>
                                                                <ChartLabel value={chartData.yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
                                                            </YAxis>
                                                            <ChartTooltip />
                                                            <Line type="monotone" dataKey="y" stroke="hsl(var(--primary))" dot={false} />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        )
                                    }
                                    case 'picture': {
                                        let pictures = value;
                                        if (!pictures || (Array.isArray(pictures) && pictures.length === 0)) return null;
                                        if (typeof pictures === 'string') pictures = [pictures];
                                        if (!Array.isArray(pictures)) return null;

                                        const images = pictures.filter(v => typeof v === 'string' && v.length > 0);
                                        if (images.length === 0) return null;

                                        const maxHeight = isCompactView ? Math.min(field.height || 300, 150) : (field.height || 300);
                                        const containerWidth = containerWidths[field.id] || 0;

                                        const totalImageWidth = images.reduce((acc, src) => {
                                            const dims = imageDimensions[src];
                                            if (!dims || dims.height === 0) {
                                                return acc + (maxHeight * (4 / 3)) + 8;
                                            }
                                            const renderedWidth = (dims.width / dims.height) * maxHeight;
                                            return acc + renderedWidth + 8;
                                        }, 0);

                                        const indentation = level * 24;
                                        const doesOverflow = containerWidth > 0 && totalImageWidth > (containerWidth - indentation - 50);

                                        const viewMode = imageViewModes[field.id] || 'carousel';
                                        const finalViewMode = isMobile ? 'carousel' : doesOverflow ? viewMode : 'grid';

                                        return (
                                            <div
                                                key={field.id}
                                                className="mt-2"
                                                onClick={(e) => e.stopPropagation()}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                                ref={el => { containerRefs.current[field.id] = el; }}
                                            >
                                                <div className="flex justify-between items-center mb-1">
                                                    <p className={cn("font-medium", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
                                                    {doesOverflow && images.length > 1 && !isMobile && (
                                                        <TooltipProvider>
                                                            <div className="flex items-center gap-1 rounded-full p-1 bg-muted">
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button variant={viewMode === 'carousel' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 rounded-full" onClick={() => setImageViewModes(prev => ({ ...prev, [field.id]: 'carousel' }))}>
                                                                            <Rows className="h-4 w-4" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent><p>Slideshow View</p></TooltipContent>
                                                                </Tooltip>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 rounded-full" onClick={() => setImageViewModes(prev => ({ ...prev, [field.id]: 'grid' }))}>
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
                                                                    return (
                                                                        <CarouselItem key={index} className={cn(!isMobile && "basis-auto", isMobile && "basis-full")}>
                                                                            <div className="p-1 h-full flex items-center justify-center">
                                                                                <CardContent className="flex h-full items-center justify-center p-0 overflow-hidden rounded-lg">
                                                                                    <img
                                                                                        src={src}
                                                                                        alt={`${field.name} ${index + 1}`}
                                                                                        className="object-contain w-full cursor-zoom-in"
                                                                                        style={{ maxHeight: `${maxHeight}px` }}
                                                                                        onClick={(e) => { e.stopPropagation(); setFullScreenImage(src); }}
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
                                                        {images.map((src, index) => (
                                                            <div key={index} className="flex items-center justify-center">
                                                                <img
                                                                    src={src}
                                                                    alt={`${field.name} ${index + 1}`}
                                                                    className="object-contain max-w-full h-auto rounded-md cursor-zoom-in"
                                                                    style={{ maxHeight: `${maxHeight}px` }}
                                                                    onClick={(e) => { e.stopPropagation(); setFullScreenImage(src); }}
                                                                    onLoad={(e) => {
                                                                        const img = e.currentTarget;
                                                                        setImageDimensions(prev => ({ ...prev, [src]: { width: img.naturalWidth, height: img.naturalHeight } }));
                                                                    }}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    }
                                    case 'attachment': {
                                        const attachments: AttachmentInfo[] = value;
                                        if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;

                                        return (
                                            <div key={field.id} className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                <p className={cn("font-medium mb-1", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
                                                <div className="space-y-2">
                                                    {attachments.map((att, index) => {
                                                        const fullUrl = `${att.path}?name=${encodeURIComponent(att.name)}`;
                                                        return (
                                                            <a key={index} href={fullUrl} download={att.name} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted">
                                                                <div className="flex items-center gap-3 overflow-hidden">
                                                                    <Icon name="File" className="h-5 w-5 text-muted-foreground shrink-0" />
                                                                    <div className="flex-1 overflow-hidden">
                                                                        <p className={cn("font-medium truncate", isCompactView ? "text-xs" : "text-sm")}>{att.name}</p>
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
                                    }
                                    case 'table-header': {
                                        if (tableRendered || tableHeaderFields.length === 0) return null;
                                        tableRendered = true;
                                        if (tableRowCountMemo === 0) return null;

                                        return (
                                            <div key="table-block" className="mt-2 text-sm min-w-0 w-full" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                <div className="overflow-x-auto rounded-md border min-w-0">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow className={cn(isCompactView && "h-8")}>
                                                                {tableHeaderFields.map(field => <TableHead key={field.id} className={cn(isCompactView && "h-8 px-2 text-xs")}>{field.name}</TableHead>)}
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {Array.from({ length: tableRowCountMemo }).map((_, rowIndex) => (
                                                                <TableRow key={rowIndex} className={cn(isCompactView && "h-8")}>
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
                                                                            <TableCell key={field.id} className={cn(isCompactView && "py-1 px-2 text-xs")}>{displayValue}</TableCell>
                                                                        )
                                                                    })}
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )
                                    }
                                    case 'query': {
                                        const queryResult = queriesAndResults.find(q => q.field.id === field.id);
                                        if (!queryResult || !queryResult.results) return null;
                                        const { results } = queryResult;

                                        return (
                                            <div key={field.id} className="mt-4 space-y-1 pt-2">
                                                {results.length > 0 ? (
                                                    results.map(resultNode => {
                                                        const resultTemplate = getTemplateById(resultNode.templateId);
                                                        const { icon: resultIcon, color: resultColor } = getConditionalStyle(resultNode, resultTemplate);
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
                                                                        <Icon name={resultIcon as any} className="h-4 w-4 shrink-0" style={{ color: resultColor }} />
                                                                        <span className={cn("font-medium truncate", isCompactView ? "text-xs" : "text-sm")}>{resultNode.name}</span>
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
                                    }
                                    default:
                                        return null;
                                }
                            })}
                        </div>
                    )}


                    {node.children && node.children.length > 0 && !isExplorer && (
                        <div
                            className={cn(
                                "children-container transition-all pr-1 pb-1",
                                "pl-3 space-y-0 pb-1 pr-1"
                            )}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {node.children.map((childNode) => (
                                <div key={`${childNode.id}_${node.id}`}>
                                    <TreeNodeComponent
                                        node={childNode}
                                        level={level + 1}
                                        siblings={node.children}
                                        onSelect={onSelect as any}
                                        contextualParentId={node.id}
                                        overrideExpandedIds={overrideExpandedIds}
                                        onExpandedChange={onExpandedChange}
                                        isCompactOverride={isCompactOverride}
                                        isExplorer={isExplorer}
                                        readOnly={readOnly}
                                        disableSelection={disableSelection}
                                    />
                                    {!readOnly && !disableSelection && <TreeNodeDropZone id={`gap_${childNode.id}_${node.id}`} />}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Image Lightbox */}
            <Dialog open={!!fullScreenImage} onOpenChange={(open) => !open && setFullScreenImage(null)}>
                <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-black/90 border-none [&>button]:bg-black/50 [&>button]:text-white [&>button]:hover:bg-black/70 [&>button]:opacity-100 [&>button]:transition-colors">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Full Screen Image</DialogTitle>
                    </DialogHeader>
                    <div className="relative w-full h-full flex items-center justify-center group/lightbox">
                        {fullScreenImage && (
                            <img
                                src={fullScreenImage}
                                alt="Full screen view"
                                className="max-w-full max-h-[90vh] object-contain"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </CollapsibleContent>
    );
}
