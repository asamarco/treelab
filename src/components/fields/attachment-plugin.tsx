"use client";

import React, { useRef } from "react";
import { FieldTypePlugin } from "@/lib/field-types/registry";
import { Paperclip, File as FileIcon, X, Loader2, Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { cn, formatBytes } from "@/lib/utils";
import { Field, AttachmentInfo } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useFieldFileUpload } from "./hooks/use-field-file-upload";

const AttachmentEditorComponent = React.memo(
  ({ field, value, onChange }: { field: Field; value: any; onChange: (value: any) => void }) => {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const currentAttachments: AttachmentInfo[] = value || [];

    const handleUploaded = (attachmentInfo: AttachmentInfo) => {
      onChange([...currentAttachments, attachmentInfo]);
      toast({
        title: "Attachment Uploaded",
        description: `File "${attachmentInfo.name}" has been saved.`,
      });
    };

    const {
      uploading,
      dragOver,
      handleDrop,
      handleDragOver,
      handleDragEnter,
      handleDragLeave,
      handleFileInputChange,
    } = useFieldFileUpload({
      field,
      onUploaded: handleUploaded,
    });

    const handleRemoveAttachment = (attachmentIndex: number) => {
      const newAttachments = currentAttachments.filter(
        (_, index) => index !== attachmentIndex
      );
      onChange(newAttachments);
    };

    return (
      <div>
        {currentAttachments.length > 0 && (
          <div className="space-y-2 mb-2">
            {currentAttachments.map((att: AttachmentInfo, index: number) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium truncate">{att.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive h-7 w-7"
                  onClick={() => handleRemoveAttachment(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
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
              <Paperclip className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">Drag & drop files here</p>
              <div className="flex items-center gap-2 w-full">
                <div className="flex-grow border-b" />
                <span className="text-xs text-muted-foreground">OR</span>
                <div className="flex-grow border-b" />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" /> Select Files
              </Button>
            </div>
          )}
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>
      </div>
    );
  }
);
AttachmentEditorComponent.displayName = "AttachmentEditorComponent";

const AttachmentViewerComponent = ({ field, value, isCompactView }: any) => {
  const attachments: AttachmentInfo[] = value;
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0)
    return null;

  return (
    <div
      className="mt-2"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <p className={cn("font-medium mb-1", isCompactView ? "text-xs" : "text-sm")}>
        {field.name}
      </p>
      <div className="space-y-2">
        {attachments.map((att, index) => {
          const fullUrl = `${att.path}?name=${encodeURIComponent(att.name)}`;
          return (
            <a
              key={index}
              href={fullUrl}
              download={att.name}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <Icon name="File" className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 overflow-hidden">
                  <p
                    className={cn(
                      "font-medium truncate",
                      isCompactView ? "text-xs" : "text-sm"
                    )}
                  >
                    {att.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p>
                </div>
              </div>
              <Download className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
            </a>
          );
        })}
      </div>
    </div>
  );
};

export const AttachmentPlugin: FieldTypePlugin = {
  type: "attachment",
  label: "Attachment",
  icon: Paperclip,
  EditorComponent: AttachmentEditorComponent,
  ViewerComponent: AttachmentViewerComponent,
};
