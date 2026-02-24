/**
 * @fileoverview
 * This component is a simplified version of NodeForm, designed for quick
 * inline editing of child nodes. It handles rendering templates fields
 * efficiently in a stacked layout.
 */
"use client";

import React, { useState, useEffect } from "react";
import { TreeNode, Template } from "@/lib/types";
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
import { DatePicker } from "../ui/date-picker";
import { format, parse, isValid, parseISO } from "date-fns";
import { generateNodeName } from "@/lib/utils";
import { useTreeContext } from "@/contexts/tree-context";

interface ChildNodeQuickEditProps {
    node: TreeNode;
    template: Template;
    onSave: (updatedNode: TreeNode) => void;
}

export const ChildNodeQuickEdit = ({
    node,
    template,
    onSave,
}: ChildNodeQuickEditProps) => {
    const [formData, setFormData] = useState<Record<string, any>>(() => {
        const initialData = { ...(node?.data || {}) };

        template.fields.forEach(field => {
            if (field.type === 'date' && initialData[field.id] && typeof initialData[field.id] === 'string') {
                const parsed = parseISO(initialData[field.id]);
                if (isValid(parsed)) {
                    initialData[field.id] = format(parsed, 'yyyy-MM-dd');
                }
            }
        });

        return initialData;
    });

    const [isDirty, setIsDirty] = useState(false);

    const handleDataChange = (fieldId: string, value: any) => {
        setFormData((prev) => ({ ...prev, [fieldId]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        const finalFormData = { ...formData };
        for (const field of template.fields) {
            if (field.type === 'date') {
                const dateValue = finalFormData[field.id];
                if (typeof dateValue === 'string' && dateValue) {
                    const parsedDate = parse(dateValue, 'yyyy-MM-dd', new Date());
                    if (isValid(parsedDate)) {
                        finalFormData[field.id] = parsedDate.toISOString();
                    }
                }
            }
        }

        const finalName = generateNodeName(template, finalFormData);
        const updatedNode: TreeNode = {
            ...node,
            name: finalName,
            data: finalFormData,
        };

        onSave(updatedNode);
        setIsDirty(false);
    };

    return (
        <div className="border rounded-md p-3 bg-card space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm truncate" title={node.name}>{node.name}</h4>
                <div className="text-xs text-muted-foreground">{template.name}</div>
            </div>

            <div className="space-y-3">
                {template.fields.map((field) => {
                    let renderedContent = null;
                    switch (field.type) {
                        case 'text':
                        case 'number':
                        case 'link':
                            renderedContent = (
                                <Input
                                    className="h-8 text-sm"
                                    type={field.type === 'number' ? 'number' : field.type === 'link' ? 'url' : 'text'}
                                    placeholder={field.name}
                                    value={formData[field.id] || ""}
                                    onChange={(e) => handleDataChange(field.id, e.target.value)}
                                />
                            );
                            break;
                        case 'textarea':
                            renderedContent = (
                                <Textarea
                                    className="min-h-[60px] text-sm"
                                    placeholder={field.name}
                                    value={formData[field.id] || ""}
                                    onChange={(e) => handleDataChange(field.id, e.target.value)}
                                />
                            );
                            break;
                        case 'date': {
                            const dateString = formData[field.id];
                            let dateValue: Date | undefined;
                            if (dateString && typeof dateString === 'string') {
                                const parsedDate = parse(dateString, 'yyyy-MM-dd', new Date());
                                if (isValid(parsedDate)) dateValue = parsedDate;
                            }
                            renderedContent = (
                                <DatePicker
                                    date={dateValue}
                                    setDate={(d) => handleDataChange(field.id, d ? format(d, 'yyyy-MM-dd') : undefined)}
                                    placeholder="Select a date"
                                />
                            );
                            break;
                        }
                        case 'dropdown':
                            renderedContent = (
                                <Select value={formData[field.id]} onValueChange={(value) => handleDataChange(field.id, value)}>
                                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                                    <SelectContent>
                                        {(field.options || []).filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            );
                            break;
                        case 'checkbox':
                            renderedContent = (
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`quick-edit-${node.id}-${field.id}`}
                                        checked={!!formData[field.id]}
                                        onCheckedChange={(checked) => handleDataChange(field.id, checked)}
                                    />
                                    <label htmlFor={`quick-edit-${node.id}-${field.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {field.name}
                                    </label>
                                </div>
                            );
                            break;
                        // Ignore complex fields for quick edit (picture, attachment, table, chart) to save space
                        default:
                            return null;
                    }

                    if (field.type === 'checkbox') return <div key={field.id}>{renderedContent}</div>;

                    return (
                        <div key={field.id} className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">{field.name}</label>
                            {renderedContent}
                        </div>
                    );
                })}
            </div>

            {isDirty && (
                <div className="flex justify-end pt-2">
                    <Button size="sm" onClick={handleSave}>Save Change</Button>
                </div>
            )}
        </div>
    );
};
