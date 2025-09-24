/**
 * @fileoverview
 * This component, `TemplateNameInput`, is a specialized input field for creating
 * template strings (like a node's name). It enhances the standard input by providing
 * autocomplete suggestions for field names.
 *
 * When a user types `{`, it suggests available field names from the template,
 * making it easier and less error-prone to construct dynamic name templates like
 * "Task: {Title}". It supports Tab completion for suggestions.
 */
"use client";

import React, { useState, useEffect, useRef, KeyboardEvent } from "react";
import { Field } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TemplateNameInputProps {
  value: string;
  onChange: (value: string) => void;
  fields: Field[];
  placeholder?: string;
}

export function TemplateNameInput({
  value,
  onChange,
  fields,
  placeholder,
}: TemplateNameInputProps) {
  const [suggestion, setSuggestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const cursorPosition = input.selectionStart ?? 0;
    const textUpToCursor = value.substring(0, cursorPosition);
    const openBraceIndex = textUpToCursor.lastIndexOf("{");
    const closeBraceIndex = textUpToCursor.lastIndexOf("}");

    if (openBraceIndex > closeBraceIndex) {
      const searchTerm = textUpToCursor.substring(openBraceIndex + 1);
      
      if (searchTerm.includes(" ")) {
         setSuggestion("");
         return;
      }
      
      const matchedField = fields.find(field => 
        field.name.toLowerCase().startsWith(searchTerm.toLowerCase())
      );

      if (matchedField && searchTerm.length > 0) {
        // Use the original casing from matchedField.name
        const originalCasePrefix = matchedField.name.substring(0, searchTerm.length);
        const remaining = matchedField.name.substring(searchTerm.length);
        const correctedValue = textUpToCursor.substring(0, openBraceIndex + 1) + originalCasePrefix;
        
        setSuggestion(remaining);
        
        // This part is visual only, to show the user the corrected casing as they type
        const ghostText = correctedValue.substring(openBraceIndex + 1);
        const ghostEl = input.parentElement?.querySelector('[data-ghost-text]');
        if (ghostEl) {
            ghostEl.textContent = ghostText + remaining;
            const textBefore = value.substring(0, openBraceIndex + 1);
            const hiddenSpan = ghostEl.parentElement?.querySelector('[data-hidden-text]');
            if(hiddenSpan) {
                hiddenSpan.textContent = textBefore;
            }
        }
        
      } else {
        setSuggestion("");
      }
    } else {
      setSuggestion("");
    }
  }, [value, fields]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowRight" && suggestion && e.currentTarget.selectionStart === value.length) {
      e.preventDefault();
      const cursorPosition = e.currentTarget.selectionStart ?? 0;
      const textUpToCursor = value.substring(0, cursorPosition);
      const openBraceIndex = textUpToCursor.lastIndexOf('{');

      if (openBraceIndex !== -1) {
          const searchTerm = textUpToCursor.substring(openBraceIndex + 1);
          const matchedField = fields.find(field =>
              field.name.toLowerCase().startsWith(searchTerm.toLowerCase())
          );
          if (matchedField) {
              const prefix = textUpToCursor.substring(0, openBraceIndex + 1);
              const suffix = value.substring(cursorPosition);
              const newValue = `${prefix}${matchedField.name}}${suffix}`;
              onChange(newValue);
              
              setTimeout(() => {
                  inputRef.current?.focus();
                  const newCursorPos = `${prefix}${matchedField.name}}`.length;
                  inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
              }, 0);
          }
      }
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {suggestion && inputRef.current && (
         <div
          className="absolute top-0 left-0 px-3 py-2 text-sm pointer-events-none text-muted-foreground flex items-center h-10 w-full"
        >
          <span data-hidden-text className="opacity-0"></span>
          <span data-ghost-text></span>
        </div>
      )}
    </div>
  );
}
