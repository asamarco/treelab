"use client";

import { useState } from "react";
import { Field, AttachmentInfo } from "@/lib/types";
import { useAuthContext } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useTreeContext } from "@/contexts/tree-context";

interface UseFieldFileUploadOptions {
  field: Field;
  validator?: (file: File) => boolean;
  onUploaded: (attachmentInfo: AttachmentInfo) => void;
}

export function useFieldFileUpload({
  field,
  validator,
  onUploaded,
}: UseFieldFileUploadOptions) {
  const { toast } = useToast();
  const { currentUser, globalSettings } = useAuthContext();
  const { activeTree } = useTreeContext();

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFileUpload = async (file: File) => {
    if (!activeTree || !currentUser) return;
    const maxMB = globalSettings?.maxUploadSizeMB ?? 5;
    if (file.size > maxMB * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Please select a file smaller than ${maxMB}MB.`,
      });
      return;
    }

    if (validator && !validator(file)) {
      return;
    }

    setUploading(true);

    const safeTimestamp = new Date().toISOString().replace(/:/g, "-");
    const uniqueFileName = `${safeTimestamp}-${crypto.randomUUID()}-${file.name}`;

    const formDataPayload = new FormData();
    formDataPayload.append("file", file);
    formDataPayload.append("uniqueFileName", uniqueFileName);
    formDataPayload.append("fileName", file.name);

    try {
      const response = await fetch("/api/upload/attachment", {
        method: "POST",
        body: formDataPayload,
        credentials: "include",
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.message || "Server error");
      }

      const { attachmentInfo } = await response.json();

      if (attachmentInfo) {
        onUploaded(attachmentInfo);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description:
          (error as Error).message || "Could not save the file to the server.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((file) => handleFileUpload(file));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => handleFileUpload(file));
    }
  };

  return {
    uploading,
    dragOver,
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleFileInputChange,
    handleFileUpload,
  };
}
