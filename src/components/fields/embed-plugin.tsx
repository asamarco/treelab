"use client";

import React, { useState } from 'react';
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { Code2, Maximize2, X } from 'lucide-react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Field } from '@/lib/types';

const EmbedDesignerSettings = ({ form, index }: { form: any, index: number }) => (
    <div className="mt-4">
        <FormField
            control={form.control}
            name={`fields.${index}.height`}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Iframe Height (px)</FormLabel>
                    <FormControl>
                        <Input
                            type="number"
                            placeholder="Default: 300"
                            {...field}
                            value={field.value || ""}
                            onChange={(e) => field.onChange(parseInt(e.target.value, 10) || undefined)}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    </div>
);

const EmbedEditorComponent = React.memo(({ field, value, onChange }: { field: Field, value: any, onChange: (value: any) => void }) => {
    const handleEmbedChange = (inputValue: string) => {
        let finalUrl = inputValue.trim();

        // Extract URL from iframe snippet if detected
        if (finalUrl.toLowerCase().startsWith('<iframe') && finalUrl.includes('src=')) {
            const srcMatch = finalUrl.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                finalUrl = srcMatch[1];
            }
        }

        // Auto-convert standard YouTube links to embed links to prevent 'X-Frame-Options' blocking
        if (finalUrl.includes('youtube.com/watch?v=')) {
            try {
                const urlObj = new URL(finalUrl);
                const videoId = urlObj.searchParams.get('v');
                if (videoId) {
                    finalUrl = `https://www.youtube.com/embed/${videoId}`;
                }
            } catch (e) {
                // fallback if URL parsing fails
            }
        } else if (finalUrl.includes('youtu.be/')) {
            const videoId = finalUrl.split('youtu.be/')[1]?.split('?')[0];
            if (videoId) {
                finalUrl = `https://www.youtube.com/embed/${videoId}`;
            }
        }
        onChange(finalUrl);
    };

    return (
        <div className="space-y-2">
            <Input
                placeholder="Paste iframe/embed URL (e.g., https://docs.google.com/.../pubhtml?widget=true)"
                value={value || ""}
                onChange={(e) => handleEmbedChange(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground italic mt-1">
                Note: Many sites block standard URLs from being embedded. Please ensure you use the site's specifically provided "Embed" or "Publish to Web" URL. Standard YouTube links will be auto-converted.
            </p>
        </div>
    );
});
EmbedEditorComponent.displayName = "EmbedEditorComponent";

const EmbedViewerComponent = ({ field, value, isCompactView }: any) => {
    const [fullScreenEmbedUrl, setFullScreenEmbedUrl] = useState<string | null>(null);
    const url = value;

    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    
    const height = field.height ? Number(field.height) : (isCompactView ? 200 : 400);

    return (
        <div className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1">
                <p className={cn("font-medium", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-full"
                                onClick={() => setFullScreenEmbedUrl(url)}
                            >
                                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>Full screen view</p></TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <div className="w-full rounded-md border bg-background overflow-hidden relative">
                <iframe
                    src={url}
                    title={field.name}
                    className="w-full border-0 block"
                    style={{ height: `${height}px` }}
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                />
            </div>

            <Dialog open={!!fullScreenEmbedUrl} onOpenChange={(open) => !open && setFullScreenEmbedUrl(null)}>
                <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 overflow-hidden border-none bg-background shadow-2xl">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Full Screen Embed</DialogTitle>
                    </DialogHeader>
                    <div className="absolute top-2 right-2 z-[60]">
                        <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 rounded-full shadow-lg bg-background/80 hover:bg-background transition-colors"
                            onClick={() => setFullScreenEmbedUrl(null)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    {fullScreenEmbedUrl && (
                        <iframe
                            src={fullScreenEmbedUrl}
                            title="Full Screen View"
                            className="w-full h-full border-0"
                            allowFullScreen
                            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export const EmbedPlugin: FieldTypePlugin = {
    type: "embed",
    label: "Embed (Iframe)",
    icon: Code2,
    DesignerSettings: EmbedDesignerSettings,
    EditorComponent: EmbedEditorComponent,
    ViewerComponent: EmbedViewerComponent,
};
