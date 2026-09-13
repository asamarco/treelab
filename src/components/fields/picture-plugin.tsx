"use client";

import React, { useState, useRef, useId, useEffect, useCallback } from "react";
import { FieldTypePlugin } from "@/lib/field-types/registry";
import { ImagePlus, GripVertical, X, Loader2, Upload, Rows, Grid, ChevronLeft, ChevronRight } from "lucide-react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Field, AttachmentInfo } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFieldFileUpload } from "./hooks/use-field-file-upload";
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
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const PictureDesignerSettings = ({ form, index }: { form: any; index: number }) => (
  <div className="mt-4">
    <FormField
      control={form.control}
      name={`fields.${index}.height`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Image Height (px)</FormLabel>
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

const DraggableImage = ({
  id,
  src,
  onRemove,
  onClick,
}: {
  id: string;
  src: string;
  onRemove: () => void;
  onClick: () => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : "auto",
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group aspect-square">
      <img
        src={src}
        alt="explorer"
        className="w-full h-full object-cover rounded-md cursor-pointer"
        onClick={onClick}
      />
      <Button
        {...attributes}
        {...listeners}
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1 left-1 h-6 w-6 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 hover:bg-background/80"
      >
        <GripVertical className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

const PictureEditorComponent = React.memo(
  ({ field, value, onChange }: { field: Field; value: any; onChange: (value: any) => void }) => {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
    const dndContextId = useId();
    const sensors = useSensors(useSensor(PointerSensor));

    const currentImages: string[] = value
      ? Array.isArray(value)
        ? value
        : [value]
      : [];

    const validatePicture = (file: File): boolean => {
      const validImageTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        "image/tiff",
        "image/bmp",
      ];
      const isValidMime = validImageTypes.includes(file.type);
      const isValidExtension = /\.(jpe?g|png|gif|svg|tif|tiff|bmp)$/i.test(file.name);

      if (!isValidMime && !isValidExtension) {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description:
            "Please upload a valid image file (jpg, png, gif, svg, tiff, webp, bmp).",
        });
        return false;
      }
      return true;
    };

    const handleUploaded = (attachmentInfo: AttachmentInfo) => {
      onChange([...currentImages, attachmentInfo.path]);
      toast({ title: "Image Uploaded", description: "The image has been saved successfully." });
    };

    const {
      uploading,
      dragOver,
      handleDrop,
      handleDragOver,
      handleDragEnter,
      handleDragLeave,
      handleFileInputChange,
      handleFileUpload,
    } = useFieldFileUpload({
      field,
      validator: validatePicture,
      onUploaded: handleUploaded,
    });

    const handlePicturePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardItems = e.clipboardData.items;
      const textItem = e.clipboardData.getData("text/plain");

      if (textItem && (textItem.startsWith("http") || textItem.startsWith("data:"))) {
        e.preventDefault();
        onChange([...currentImages, textItem]);
        (e.target as HTMLTextAreaElement).value = "";
        return;
      }

      const imageItem = Array.from(clipboardItems).find((item) =>
        item.type.startsWith("image/")
      );

      if (!imageItem) return;
      e.preventDefault();

      const file = imageItem.getAsFile();
      if (file) {
        handleFileUpload(file);
      }
    };

    const handleRemoveImage = (imageIndex: number) => {
      const newImages = currentImages.filter((_, index) => index !== imageIndex);
      onChange(newImages);
    };

    const handleImageDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = currentImages.indexOf(active.id as string);
        const newIndex = currentImages.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          onChange(arrayMove(currentImages, oldIndex, newIndex));
        }
      }
    };

    return (
      <div>
        <DndContext
          id={`${dndContextId}-images`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleImageDragEnd}
        >
          <SortableContext items={currentImages} strategy={rectSortingStrategy}>
            {currentImages.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mb-2">
                {currentImages.map((imgSrc: string, idx: number) => (
                  <DraggableImage
                    key={imgSrc}
                    id={imgSrc}
                    src={imgSrc}
                    onRemove={() => handleRemoveImage(idx)}
                    onClick={() => setFullScreenImage(imgSrc)}
                  />
                ))}
              </div>
            )}
          </SortableContext>
        </DndContext>
        <div
          className={cn(
            "p-4 border-2 border-dashed rounded-lg text-center transition-colors",
            dragOver ? "border-primary bg-accent" : "border-border",
            uploading && "border-solid"
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          {uploading ? (
            <div className="flex flex-col items-center justify-center gap-2 p-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <ImagePlus className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">
                Drag & drop images, paste an image, or enter a URL.
              </p>
              <div className="flex items-center gap-2 w-full">
                <Textarea
                  id={`picture-url-${field.id}`}
                  placeholder="Paste URL or image"
                  value={""}
                  onChange={(e) => {
                    e.target.value = "";
                  }}
                  onPaste={handlePicturePaste}
                  rows={1}
                  className="text-xs"
                />
                <span className="text-xs text-muted-foreground">OR</span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" /> Select Files
                </Button>
              </div>
            </div>
          )}
          <input
            type="file"
            accept="image/*,image/tiff,image/bmp"
            multiple
            ref={fileInputRef}
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>

        {/* Image Lightbox (Editor) */}
        <Dialog
          open={!!fullScreenImage}
          onOpenChange={(open) => !open && setFullScreenImage(null)}
        >
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-black/90 border-none [&>button]:bg-black [&>button]:text-white [&>button]:hover:bg-black/80 [&>button]:opacity-100 [&>button]:transition-colors">
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
      </div>
    );
  }
);
PictureEditorComponent.displayName = "PictureEditorComponent";

const PictureViewerComponent = ({ field, value, isCompactView }: any) => {
  let pictures = value;
  if (typeof pictures === "string") pictures = [pictures];
  const images: string[] = Array.isArray(pictures)
    ? pictures.filter((v: any) => typeof v === "string" && v.length > 0)
    : [];

  if (images.length === 0) return null;

  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [imageViewMode, setImageViewMode] = useState<"carousel" | "grid">("carousel");
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [fullScreenGallery, setFullScreenGallery] = useState<{ images: string[]; index: number } | null>(null);

  const goToPrevImage = useCallback(() => {
    setFullScreenGallery((prev) => {
      if (!prev || prev.images.length <= 1) return prev;
      const newIndex = prev.index === 0 ? prev.images.length - 1 : prev.index - 1;
      return { ...prev, index: newIndex };
    });
  }, []);

  const goToNextImage = useCallback(() => {
    setFullScreenGallery((prev) => {
      if (!prev || prev.images.length <= 1) return prev;
      const newIndex = prev.index === prev.images.length - 1 ? 0 : prev.index + 1;
      return { ...prev, index: newIndex };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!fullScreenGallery) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevImage();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNextImage();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullScreenGallery, goToPrevImage, goToNextImage]);

  const maxHeight = isCompactView ? Math.min(field.height || 300, 150) : field.height || 300;

  const totalImageWidth = images.reduce((acc, src) => {
    const dims = imageDimensions[src];
    if (!dims || dims.height === 0) {
      return acc + maxHeight * (4 / 3) + 8;
    }
    const renderedWidth = (dims.width / dims.height) * maxHeight;
    return acc + renderedWidth + 8;
  }, 0);

  const doesOverflow = containerWidth > 0 && totalImageWidth > containerWidth - 50;
  const finalViewMode = isMobile ? "carousel" : doesOverflow ? imageViewMode : "grid";

  const openFullScreenGallery = (imgs: string[], idx: number) => {
    setFullScreenGallery({ images: imgs, index: idx });
  };

  return (
    <div
      className="mt-2"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      ref={containerRef}
    >
      <div className="flex justify-between items-center mb-1">
        <p className={cn("font-medium", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
        {doesOverflow && images.length > 1 && !isMobile && (
          <TooltipProvider>
            <div className="flex items-center gap-1 rounded-full p-1 bg-muted">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={imageViewMode === "carousel" ? "secondary" : "ghost"}
                    size="icon"
                    className="h-6 w-6 rounded-full"
                    onClick={() => setImageViewMode("carousel")}
                  >
                    <Rows className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Slideshow View</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={imageViewMode === "grid" ? "secondary" : "ghost"}
                    size="icon"
                    className="h-6 w-6 rounded-full"
                    onClick={() => setImageViewMode("grid")}
                  >
                    <Grid className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Grid View</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        )}
      </div>

      {finalViewMode === "carousel" ? (
        <div className="mx-auto" style={{ maxWidth: "100%" }}>
          <Carousel className="w-full" opts={{ loop: images.length > 1, align: "start" }}>
            <CarouselContent>
              {images.map((src, index) => (
                <CarouselItem
                  key={index}
                  className={cn(!isMobile && "basis-auto", isMobile && "basis-full")}
                >
                  <div className="p-1 h-full flex items-center justify-center">
                    <CardContent className="flex h-full items-center justify-center p-0 overflow-hidden rounded-lg">
                      <img
                        src={src}
                        alt={`${field.name} ${index + 1}`}
                        className="object-contain w-full cursor-zoom-in"
                        style={{ maxHeight: `${maxHeight}px` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openFullScreenGallery(images, index);
                        }}
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setImageDimensions((prev) => ({
                            ...prev,
                            [src]: { width: img.naturalWidth, height: img.naturalHeight },
                          }));
                        }}
                      />
                    </CardContent>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            {images.length > 1 && (
              <>
                <CarouselPrevious />
                <CarouselNext />
              </>
            )}
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
                onClick={(e) => {
                  e.stopPropagation();
                  openFullScreenGallery(images, index);
                }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImageDimensions((prev) => ({
                    ...prev,
                    [src]: { width: img.naturalWidth, height: img.naturalHeight },
                  }));
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Image Lightbox (Viewer) */}
      <Dialog open={!!fullScreenGallery} onOpenChange={(open) => !open && setFullScreenGallery(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-black/90 border-none [&>button]:bg-black [&>button]:text-white [&>button]:hover:bg-black/80 [&>button]:opacity-100 [&>button]:transition-colors">
          <DialogHeader className="sr-only">
            <DialogTitle>Full Screen Image</DialogTitle>
          </DialogHeader>
          <div className="relative w-full h-full flex items-center justify-center group/lightbox">
            {fullScreenGallery && (
              <>
                <img
                  src={fullScreenGallery.images[fullScreenGallery.index]}
                  alt={`Full screen view ${fullScreenGallery.index + 1} of ${fullScreenGallery.images.length}`}
                  className="max-w-full max-h-[90vh] object-contain"
                />
                {fullScreenGallery.images.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white opacity-80 sm:opacity-0 sm:group-hover/lightbox:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        goToPrevImage();
                      }}
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white opacity-80 sm:opacity-0 sm:group-hover/lightbox:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        goToNextImage();
                      }}
                      aria-label="Next image"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </Button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
                      {fullScreenGallery.index + 1} / {fullScreenGallery.images.length}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const PicturePlugin: FieldTypePlugin = {
  type: "picture",
  label: "Picture",
  icon: ImagePlus,
  DesignerSettings: PictureDesignerSettings,
  EditorComponent: PictureEditorComponent,
  ViewerComponent: PictureViewerComponent,
};
