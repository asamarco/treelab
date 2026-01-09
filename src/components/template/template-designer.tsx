

/**
 * @fileoverview
 * This component, `TemplateDesigner`, is the core UI for creating and editing templates.
 * It's a complex form built with `react-hook-form` and `zod` for validation.
 *
 * Key features:
 * - Allows defining template name, icon, color, and name/body formats.
 * - Manages a dynamic array of fields for the template.
 * - Supports various field types (text, date, dropdown, table, etc.).
 * - Implements drag-and-drop for reordering fields using `@dnd-kit`.
 * - Provides options to import and export a single template definition as JSON.
 */
"use client";

import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Template, Field, ConditionalRuleOperator } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  PlusCircle,
  Upload,
  Download,
  GripVertical,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import React, { useRef, useEffect, useState } from "react";
import { IconPicker } from "../icon-picker";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TemplateNameInput } from "./template-name-input";
import { TemplateTextarea } from "./template-textarea";
import { cn } from "@/lib/utils";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTreeContext } from "@/contexts/tree-context";
import { MultiSelect } from "../ui/multi-select";


const fieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Field name is required"),
  type: z.enum(["text", "number", "date", "dropdown", "textarea", "link", "picture", "table-header", "dynamic-dropdown", "attachment"]),
  options: z.array(z.string()).optional(),
  columnType: z.enum(["text", "number", "date"]).optional(),
  height: z.number().optional(),
  prefix: z.string().optional(),
  postfix: z.string().optional(),
});

const conditionalRuleSchema = z.object({
  id: z.string(),
  fieldId: z.string().min(1, 'Please select a field.'),
  operator: z.string().min(1, 'Please select an operator.'),
  value: z.string(),
  icon: z.string().min(1, 'Please select an icon.'),
  color: z.string().min(1, 'Please select a color.'),
});

const templateSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Template name is required"),
  icon: z.string().optional(),
  color: z.string().optional(),
  nameTemplate: z.string().min(1, "Node name template is required"),
  bodyTemplate: z.string().optional(),
  fields: z
    .array(fieldSchema)
    .min(1, "A template must have at least one field."),
  conditionalRules: z.array(conditionalRuleSchema).optional(),
  preferredChildTemplates: z.array(z.string()).optional(),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

interface TemplateDesignerProps {
  template: Partial<Template>;
  allTemplates: Template[];
  onSave: (data: Template) => void;
  onCancel: () => void;
  onSelect: (template: Template) => void;
}

function DraggableFieldWrapper({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 100 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="cursor-grab shrink-0 mt-8"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </Button>
      <div className="w-full">{children}</div>
    </div>
  );
}

function DraggableRuleWrapper({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 100 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="cursor-grab shrink-0 mt-8"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </Button>
      <div className="w-full">{children}</div>
    </div>
  );
}


const operatorLabels: Record<ConditionalRuleOperator, string> = {
  equals: 'Equals',
  not_equals: 'Not Equals',
  contains: 'Contains',
  not_contains: 'Does Not Contain',
  is_not_empty: 'Is Not Empty',
  is_empty: 'Is Empty',
  greater_than: 'Greater Than',
  less_than: 'Less Than',
};

const prefixPostfixSupportedTypes: Field['type'][] = ["text", "number", "date", "dropdown", "dynamic-dropdown", "table-header"];

export function TemplateDesigner({
  template,
  allTemplates,
  onSave,
  onCancel,
  onSelect,
}: TemplateDesignerProps) {
  const { toast } = useToast();
  const { updateNodeNamesForTemplate } = useTreeContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [templateForNodeUpdate, setTemplateForNodeUpdate] = useState<Template | null>(null);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: template,
  });

  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: "fields",
  });
  
  const { fields: conditionalRules, append: appendRule, remove: removeRule, move: moveRule } = useFieldArray({
    control: form.control,
    name: "conditionalRules",
  });

  const watchedFields = form.watch('fields');
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleFieldDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex((field) => field.id === active.id);
      const newIndex = fields.findIndex((field) => field.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        move(oldIndex, newIndex);
      }
    }
  };

  const handleRuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = conditionalRules.findIndex((rule) => rule.id === active.id);
      const newIndex = conditionalRules.findIndex((rule) => rule.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        moveRule(oldIndex, newIndex);
      }
    }
  };

  const initialNameTemplateRef = useRef(template.nameTemplate);
  
  useEffect(() => {
    // This effect now only handles the logic for prompting to update existing nodes.
    // The form data loading is handled by the `key` prop on the component.
    const isNew = template.id?.startsWith('new_');
    if (!isNew && template.nameTemplate !== initialNameTemplateRef.current && initialNameTemplateRef.current !== undefined) {
      setTemplateForNodeUpdate(template as Template);
    }
    initialNameTemplateRef.current = template.nameTemplate;
  }, [template.nameTemplate, template.id]);
  
  const onSubmit = (data: TemplateFormValues) => {
    toast({
      title: "Template saved!",
      description: `The "${data.name}" template has been successfully saved.`,
    });
    onSave(data as Template);
  };

  const handleExport = () => {
    const data = JSON.stringify(form.getValues(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.getValues("name") || "template"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result;
          if (typeof content !== "string")
            throw new Error("File content is not valid");
          const importedData = JSON.parse(content);
          
          const validation = templateSchema.safeParse(importedData);
          if (validation.success) {
            const dataToLoad = validation.data;
            // Preserve the ID of the template being edited, but load all other data.
            const currentId = form.getValues('id');
            form.reset({
              ...dataToLoad,
              id: currentId,
            });
            
            toast({
              title: "Template Loaded",
              description: `Data from "${dataToLoad.name}" has been loaded into the designer. Click Save to apply.`,
            });
          } else {
            console.error("Template validation failed:", validation.error);
            toast({
              variant: "destructive",
              title: "Import Failed",
              description: "The selected file is not a valid template.",
            });
          }
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Import Error",
            description: "Could not read or parse the file.",
          });
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
      };
      reader.readAsText(file);
    }
  };

  const handleConfirmNodeUpdate = () => {
    if (templateForNodeUpdate) {
        updateNodeNamesForTemplate(templateForNodeUpdate);
        toast({
            title: "Node Names Updated",
            description: `All nodes using the "${templateForNodeUpdate.name}" template will be updated.`
        });
        setTemplateForNodeUpdate(null);
    }
  };

  const availableChildTemplates = allTemplates
  .filter((t) => t.id !== template.id)
  .map((t) => ({
    value: t.id,
    label: t.name,
  }));

  return (
    <>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Template Designer</CardTitle>
                <CardDescription>
                  {template.id && !template.id.startsWith('new_')
                    ? "Editing an existing template."
                    : "Creating a new template."}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" /> Import
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImport}
                  accept=".json"
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                >
                  <Download className="mr-2 h-4 w-4" /> Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Project, Task, User"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nameTemplate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Node Name Template</FormLabel>
                    <FormControl>
                       <TemplateNameInput
                          value={field.value}
                          onChange={field.onChange}
                          fields={form.watch('fields')}
                          placeholder="e.g., Task: {Title}"
                        />
                    </FormControl>
                    <FormDescription>
                      Define the node name using plain text and field names in curly braces, like `{"{field name}"}`.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bodyTemplate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Body Template</FormLabel>
                    <FormControl>
                       <TemplateTextarea
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          fields={form.watch('fields')}
                          placeholder="e.g., Assigned to: {Assignee}\nStatus: {Status}"
                        />
                    </FormControl>
                    <FormDescription>
                      Define the node body content using plain text and field names in curly braces.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Icon</FormLabel>
                      <FormControl>
                        <IconPicker
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Accent Color</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="color"
                            {...field}
                            className="h-10 w-12 p-1"
                          />
                          <Input
                            type="text"
                            placeholder="#RRGGBB"
                            className="w-full"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="preferredChildTemplates"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Preferred Child Templates</FormLabel>
                        <FormControl>
                            <MultiSelect
                                options={availableChildTemplates}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Select preferred templates..."
                                className="w-full"
                            />
                        </FormControl>
                        <FormDescription>
                            These templates will be shown first when adding a child to a node of this type.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
                />
            </div>
            <Separator />
            <div>
              <h3 className="text-lg font-medium mb-4">Fields</h3>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleFieldDragEnd}
              >
                <SortableContext
                  items={fields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    {fields.map((field, index) => (
                      <DraggableFieldWrapper key={field.id} id={field.id}>
                        <Card className="bg-muted/50 p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                              control={form.control}
                              name={`fields.${index}.name`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Field Name</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="e.g., Assignee, Due Date"
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <Controller
                              control={form.control}
                              name={`fields.${index}.type`}
                              render={({ field: { onChange, value } }) => (
                                <FormItem>
                                  <FormLabel>Field Type</FormLabel>
                                  <Select
                                    onValueChange={onChange}
                                    defaultValue={value}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select a type" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="text">Text</SelectItem>
                                      <SelectItem value="textarea">
                                        Text Area
                                      </SelectItem>
                                      <SelectItem value="number">
                                        Number
                                      </SelectItem>
                                      <SelectItem value="date">Date</SelectItem>
                                      <SelectItem value="link">Link</SelectItem>
                                      <SelectItem value="picture">Picture</SelectItem>
                                      <SelectItem value="attachment">Attachment</SelectItem>
                                      <SelectItem value="table-header">Table Header</SelectItem>
                                      <SelectItem value="dropdown">
                                        Dropdown
                                      </SelectItem>
                                       <SelectItem value="dynamic-dropdown">
                                        Dynamic Dropdown
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          {prefixPostfixSupportedTypes.includes(form.watch(`fields.${index}.type`)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <FormField
                                control={form.control}
                                name={`fields.${index}.prefix`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Prefix</FormLabel>
                                    <FormControl>
                                      <Input placeholder="e.g., $" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name={`fields.${index}.postfix`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Postfix</FormLabel>
                                    <FormControl>
                                      <Input placeholder="e.g., kg" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          )}
                           {form.watch(`fields.${index}.type`) === 'picture' && (
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
                            )}
                            {form.watch(`fields.${index}.type`) === "table-header" && (
                              <div className="mt-4">
                                 <FormField
                                  control={form.control}
                                  name={`fields.${index}.columnType`}
                                  render={({ field }) => (
                                    <FormItem className="space-y-3">
                                      <FormLabel>Column Data Type</FormLabel>
                                      <FormControl>
                                        <RadioGroup
                                          onValueChange={field.onChange}
                                          defaultValue={field.value}
                                          className="flex space-x-4"
                                        >
                                          <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl>
                                              <RadioGroupItem value="text" />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                              Text
                                            </FormLabel>
                                          </FormItem>
                                          <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl>
                                              <RadioGroupItem value="number" />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                              Number
                                            </FormLabel>
                                          </FormItem>
                                          <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl>
                                              <RadioGroupItem value="date" />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                              Date
                                            </FormLabel>
                                          </FormItem>
                                        </RadioGroup>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            )}
                          {form.watch(`fields.${index}.type`) ===
                            "dropdown" && (
                            <FormField
                              control={form.control}
                              name={`fields.${index}.options`}
                              render={({ field }) => (
                                <FormItem className="mt-4">
                                  <FormLabel>Dropdown Options</FormLabel>
                                  <FormControl>
                                    <Textarea
                                      placeholder="Enter options, separated by commas (e.g., To Do, In Progress, Done)"
                                      name={field.name}
                                      ref={field.ref}
                                      value={
                                        Array.isArray(field.value)
                                          ? field.value.join(",")
                                          : ""
                                      }
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value.split(",")
                                        )
                                      }
                                      onBlur={(e) => {
                                        field.onChange(
                                          e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter((s) => s.length > 0)
                                        );
                                        field.onBlur();
                                      }}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="mt-4"
                            onClick={() => {
                              remove(index);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Remove Field
                          </Button>
                        </Card>
                      </DraggableFieldWrapper>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  append({
                    id: new Date().toISOString() + Math.random(),
                    name: "",
                    type: "text",
                  })
                }
              >
                <PlusCircle className="mr-2 h-4 w-4" /> Add Field
              </Button>
            </div>
            <Separator />
            <div>
              <h3 className="text-lg font-medium mb-4">Conditional Formatting</h3>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleRuleDragEnd}
              >
                <SortableContext
                  items={conditionalRules.map((rule) => rule.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    {conditionalRules.map((rule, index) => (
                      <DraggableRuleWrapper key={rule.id} id={rule.id}>
                        <Card className="bg-muted/50 p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <FormField
                                control={form.control}
                                name={`conditionalRules.${index}.fieldId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Field</FormLabel>
                                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                                      <FormControl>
                                        <SelectTrigger><SelectValue placeholder="Select a field..." /></SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {watchedFields.map(f => (
                                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            <FormField
                                control={form.control}
                                name={`conditionalRules.${index}.operator`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Operator</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                      <FormControl>
                                        <SelectTrigger><SelectValue placeholder="Select an operator..." /></SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {Object.entries(operatorLabels).map(([op, label]) => (
                                          <SelectItem key={op} value={op}>{label}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            <FormField
                                control={form.control}
                                name={`conditionalRules.${index}.value`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Value</FormLabel>
                                    <FormControl>
                                      <Input placeholder="Value to check" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <FormField
                                control={form.control}
                                name={`conditionalRules.${index}.icon`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>New Icon</FormLabel>
                                    <FormControl>
                                      <IconPicker value={field.value} onChange={field.onChange} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            <FormField
                                control={form.control}
                                name={`conditionalRules.${index}.color`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>New Color</FormLabel>
                                    <FormControl>
                                      <div className="flex items-center gap-2">
                                        <Input type="color" {...field} className="h-10 w-12 p-1"/>
                                        <Input type="text" placeholder="#RRGGBB" {...field} />
                                      </div>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                          </div>
                          <Button type="button" variant="destructive" size="sm" className="mt-4" onClick={() => removeRule(index)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Remove Rule
                          </Button>
                        </Card>
                      </DraggableRuleWrapper>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <Button type="button" variant="outline" className="mt-4" onClick={() => appendRule({
                  id: new Date().toISOString() + Math.random(),
                  fieldId: '',
                  operator: 'equals',
                  value: '',
                  icon: 'FileText',
                  color: '#64748b'
              })}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Rule
              </Button>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">Save Template</Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
    <AlertDialog open={!!templateForNodeUpdate} onOpenChange={(open) => !open && setTemplateForNodeUpdate(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Update Existing Nodes?</AlertDialogTitle>
                <AlertDialogDescription>
                    The "Node Name Template" has changed. Would you like to apply this new naming rule to all existing nodes that use the "{templateForNodeUpdate?.name}" template?
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setTemplateForNodeUpdate(null)}>Leave Them</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmNodeUpdate}>Update Nodes</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
  
