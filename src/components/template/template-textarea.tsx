/**
 * @fileoverview
 * This component, `TemplateTextarea`, is a specialized textarea for creating
 * multi-line template strings (like a node's body). It mirrors the functionality
 * of `TemplateNameInput` but for a textarea element.
 *
 * It provides autocomplete suggestions for field names when a user types `{`,
 * making it easier to construct dynamic content templates. It supports Tab completion
 * and correctly positions the suggestion overlay even in a scrolling, multi-line context.
 */
"use client";

import React, { useState, useEffect, useRef, KeyboardEvent } from "react";
import { Field } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface TemplateTextareaProps {
  value: string;
  onChange: (value: string) => void;
  fields: Field[];
  placeholder?: string;
}

const getCursorPosition = (textarea: HTMLTextAreaElement) => {
  const { selectionStart, value } = textarea;
  const textUpToCursor = value.substring(0, selectionStart);

  const mirror = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "whiteSpace",
    "wordBreak",
    "wordSpacing",
    "boxSizing",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
  ].forEach((prop: any) => {
    mirror.style[prop as any] = style[prop as any];
  });
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
  mirror.style.height = "auto";
  mirror.style.minHeight = 'auto';


  // Use a non-breaking space to ensure the div has height even for empty lines
  mirror.innerHTML = textUpToCursor.replace(/\n/g, "<br/>") + "<span>&nbsp;</span>";
  document.body.appendChild(mirror);
  
  const cursorSpan = mirror.querySelector("span");
  const top = cursorSpan!.offsetTop - textarea.scrollTop;
  const left = cursorSpan!.offsetLeft - textarea.scrollLeft;
  
  document.body.removeChild(mirror);

  return { top, left };
};

export function TemplateTextarea({
  value,
  onChange,
  fields,
  placeholder,
}: TemplateTextareaProps) {
  const [suggestion, setSuggestion] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestionPos, setSuggestionPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPosition = textarea.selectionStart ?? 0;
    const textUpToCursor = value.substring(0, cursorPosition);
    const openBraceIndex = textUpToCursor.lastIndexOf("{");
    const closeBraceIndex = textUpToCursor.lastIndexOf("}");

    if (openBraceIndex > closeBraceIndex) {
      const searchTerm = textUpToCursor.substring(openBraceIndex + 1);

      if (searchTerm.includes(" ") || searchTerm.includes("\n")) {
        setSuggestion("");
        return;
      }

      const matchedField = fields.find((field) =>
        field.name.toLowerCase().startsWith(searchTerm.toLowerCase())
      );

      if (matchedField && searchTerm.length > 0) {
        const remaining = matchedField.name.substring(searchTerm.length);
        setSuggestion(remaining);
        setSuggestionPos(getCursorPosition(textarea));
      } else {
        setSuggestion("");
      }
    } else {
      setSuggestion("");
    }
  }, [value, fields]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
                  textareaRef.current?.focus();
                  const newCursorPos = `${prefix}${matchedField.name}}`.length;
                  textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
              }, 0);
          }
      }
    }
  };
  
  const handleScrollAndResize = () => {
    if (textareaRef.current) {
        const { selectionStart } = textareaRef.current;
        const textUpToCursor = textareaRef.current.value.substring(0, selectionStart);
        const openBraceIndex = textUpToCursor.lastIndexOf("{");
        const closeBraceIndex = textUpToCursor.lastIndexOf("}");
        
        if (openBraceIndex > closeBraceIndex) {
            setSuggestionPos(getCursorPosition(textareaRef.current));
        } else {
            setSuggestion("");
        }
    }
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const resizeObserver = new ResizeObserver(handleScrollAndResize);
    resizeObserver.observe(textarea);

    return () => resizeObserver.disconnect();
  }, [])

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={handleScrollAndResize}
        onClick={handleScrollAndResize}
        placeholder={placeholder}
      />
      {suggestion && textareaRef.current && (
        <div
          className="absolute text-sm pointer-events-none text-muted-foreground flex items-center"
          style={{
            top: `${suggestionPos.top}px`,
            left: `${suggestionPos.left}px`,
            fontFamily: window.getComputedStyle(textareaRef.current).fontFamily,
            fontSize: window.getComputedStyle(textareaRef.current).fontSize,
            lineHeight: window.getComputedStyle(textareaRef.current).lineHeight,
            paddingTop: 0,
            paddingBottom: 0,
          }}
        >
          <span>{suggestion}</span>
        </div>
      )}
    </div>
  );
}
