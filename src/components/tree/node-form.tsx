
/**
 * @fileoverview
 * This file defines the `NodeForm` component, which is a dynamic form used for
 * creating and editing tree nodes. The form's fields are generated based on the
 * provided `Template`.
 *
 * It supports various field types (text, date, dropdown, picture, table, etc.) and
 * handles data input and state management for the node being edited. On submission,
 * it automatically generates the node's name based on the `nameTemplate` and calls
 * the `onSave` callback with the new node data.
 */
"use client";

import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { TreeNode, Template, Field, AttachmentInfo, QueryDefinition, QueryRule, ConditionalRuleOperator, ChecklistItem, SimpleQueryRule } from "@/lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { FieldRegistry } from "@/lib/field-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar as CalendarIcon, PlusCircle, Trash2, Link } from "lucide-react";
import { format, parse, isValid, parseISO } from "date-fns";
import { cn, generateClientSideId } from "@/lib/utils";
import {
  DialogFooter,
  DialogClose
} from "../ui/dialog";
import { Label } from "../ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTreeContext } from "@/contexts/tree-context";
import { useAuthContext } from "@/contexts/auth-context";
import { Combobox } from "../ui/combobox";
import { generateNodeName, formatDate } from "@/lib/utils";
import { Card, CardContent } from "../ui/card";
import path from "path";
import { Separator } from "../ui/separator";
import { useUIContext } from "@/contexts/ui-context";
import { DatePicker } from "../ui/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";


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

export const NodeForm = ({
  node,
  template,
  onSave,
  onClose,
  contextualParentId,
  isMultiEdit = false,
}: {
  node?: Partial<TreeNode>;
  template: Template;
  onSave: (data: TreeNode) => void;
  onClose: () => void;
  contextualParentId: string | null;
  isMultiEdit?: boolean;
}) => {
  const { tree, activeTree, findNodeAndParent, templates, updateNode } = useTreeContext();
  const { setDialogState } = useUIContext();
  const { toast } = useToast();

  const [formData, setFormData] = useState<Record<string, any>>(() => {
    if (isMultiEdit) return {};
    const initialData = { ...(node?.data || {}) };

    template.fields.forEach(field => {
      if (field.type === 'date' && initialData[field.id] && typeof initialData[field.id] === 'string') {
        const parsed = parseISO(initialData[field.id]);
        if (isValid(parsed)) {
          initialData[field.id] = format(parsed, 'yyyy-MM-dd');
        }
      } else if (field.type === 'table-header' && field.columnType === 'date' && Array.isArray(initialData[field.id])) {
        initialData[field.id] = initialData[field.id].map((dateStr: string) => {
          if (typeof dateStr === 'string') {
            const parsed = parseISO(dateStr);
            return isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : dateStr;
          }
          return dateStr;
        });
      }
    });

    return initialData;
  });

  const { currentUser } = useAuthContext();

  const parentIndex = contextualParentId ? (node?.parentIds || []).indexOf(contextualParentId) : 0;
  const contextualOrder = (parentIndex !== -1 && node?.order && (node.order.length > parentIndex))
    ? node.order[parentIndex]
    : 0;

  const [orderString, setOrderString] = useState(contextualOrder.toString());

  useEffect(() => {
    const pIdx = contextualParentId ? (node?.parentIds || []).indexOf(contextualParentId) : 0;
    const cOrder = (pIdx !== -1 && node?.order && (node.order.length > pIdx))
      ? node.order[pIdx]
      : 0;
    setOrderString(cOrder.toString());
  }, [node, contextualParentId]);


  const tableHeaderFields = useMemo(() => template.fields.filter(f => f.type === 'table-header'), [template.fields]);

  const queryFields = useMemo(() => template.fields.filter(f => f.type === 'query'), [template.fields]);

  // Pre-compute all dynamic dropdown values in a single tree walk.
  // Cache keyed by "templateId::fieldId" -> Set<string>, so individual
  // getDynamicOptions calls are O(1) lookups instead of O(N) traversals.
  const dynamicOptionsCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    const traverse = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.data) {
          for (const [fieldId, value] of Object.entries(n.data)) {
            if (typeof value === 'string' && value) {
              const key = `${n.templateId}::${fieldId}`;
              let set = cache.get(key);
              if (!set) {
                set = new Set<string>();
                cache.set(key, set);
              }
              set.add(value);
            }
          }
        }
        if (n.children) traverse(n.children);
      }
    };
    traverse(tree);
    return cache;
  }, [tree]);

  const getDynamicOptions = useMemo(() => {
    return (fieldId: string, templateId: string): { value: string, label: string }[] => {
      const values = dynamicOptionsCache.get(`${templateId}::${fieldId}`);
      if (!values) return [];
      return Array.from(values).map(v => ({ value: v, label: v }));
    };
  }, [dynamicOptionsCache]);

  const handleTableChange = (rowIndex: number, fieldId: string, value: string | undefined) => {
    setFormData(prev => {
      const newFormData = { ...prev };
      const currentData = Array.isArray(newFormData[fieldId]) ? [...newFormData[fieldId]] : [];
      currentData[rowIndex] = value;
      newFormData[fieldId] = currentData;
      return newFormData;
    });
  };

  const getTableRowCount = () => {
    if (tableHeaderFields.length === 0) return 0;
    const firstColumnData = formData[tableHeaderFields[0].id];
    return Array.isArray(firstColumnData) ? firstColumnData.length : 0;
  };

  const handleAddRow = () => {
    setFormData(prev => {
      const newFormData = { ...prev };
      tableHeaderFields.forEach(field => {
        const currentData = Array.isArray(newFormData[field.id]) ? [...newFormData[field.id]] : [];
        currentData.push('');
        newFormData[field.id] = currentData;
      });
      return newFormData;
    });
  };

  const handleRemoveRow = (rowIndex: number) => {
    setFormData(prev => {
      const newFormData = { ...prev };
      tableHeaderFields.forEach(field => {
        if (Array.isArray(newFormData[field.id])) {
          const newColumnData = [...newFormData[field.id]];
          newColumnData.splice(rowIndex, 1);
          newFormData[field.id] = newColumnData;
        }
      });
      return newFormData;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isMultiEdit) {
      const dirtyData: Record<string, any> = {};
      let isFormValid = true;

      for (const field of template.fields) {
        const value = formData[field.id];
        if (value !== undefined && value !== '') {
          if (field.type === 'date' && typeof value === 'string') {
            const parsedDate = parse(value, 'yyyy-MM-dd', new Date());
            if (isValid(parsedDate)) {
              dirtyData[field.id] = parsedDate.toISOString();
            } else {
              toast({ variant: 'destructive', title: 'Invalid Date', description: `Date for "${field.name}" is invalid.` });
              isFormValid = false;
              break;
            }
          } else {
            dirtyData[field.id] = value;
          }
        }
      }

      if (isFormValid) {
        for (const field of template.fields) {
          if (dirtyData[field.id] !== undefined) {
            const plugin = FieldRegistry.get(field.type);
            if (plugin?.sanitizeOnSave) {
              dirtyData[field.id] = plugin.sanitizeOnSave(dirtyData[field.id]);
            }
          }
        }
        onSave({ data: dirtyData } as TreeNode);
      }
      return;
    }

    const finalFormData = { ...formData };
    let isFormValid = true;

    for (const field of template.fields) {
      if (field.type === 'date' || (field.type === 'table-header' && field.columnType === 'date')) {
        const values = Array.isArray(finalFormData[field.id]) ? finalFormData[field.id] : [finalFormData[field.id]];

        const isoValues = values.map((dateValue: string | undefined) => {
          if (!dateValue) return undefined;
          if (typeof dateValue !== 'string') return dateValue;

          const parsedDate = parse(dateValue, 'yyyy-MM-dd', new Date());

          if (isValid(parsedDate)) {
            return parsedDate.toISOString();
          } else if (dateValue) {
            toast({
              variant: 'destructive',
              title: 'Invalid Date',
              description: `The date for "${field.name}" is not a valid format. Please use the date picker.`,
            });
            isFormValid = false;
            return dateValue;
          }
          return undefined;
        });

        if (!isFormValid) break;

        if (field.type === 'date') {
          finalFormData[field.id] = isoValues[0];
        } else {
          finalFormData[field.id] = isoValues;
        }
      }
    }

    if (!isFormValid) {
      return;
    }

    for (const field of template.fields) {
      if (finalFormData[field.id] !== undefined) {
        const plugin = FieldRegistry.get(field.type);
        if (plugin?.sanitizeOnSave) {
          finalFormData[field.id] = plugin.sanitizeOnSave(finalFormData[field.id]);
        }
      }
    }

    const finalName = generateNodeName(template, finalFormData);
    const newOrderValue = parseInt(orderString, 10);

    const newOrderArray = [...(node?.order || [])];
    if (parentIndex !== -1) {
      newOrderArray[parentIndex] = isNaN(newOrderValue) ? contextualOrder : newOrderValue;
    } else if (node?.parentIds) {
      newOrderArray.push(isNaN(newOrderValue) ? 0 : newOrderValue);
    } else {
      newOrderArray[0] = isNaN(newOrderValue) ? 0 : newOrderValue;
    }


    const newNode: TreeNode = {
      id: node?.id || generateClientSideId(),
      name: finalName,
      templateId: template.id,
      data: finalFormData || {},
      children: node?.children || [],
      userId: node?.userId || '',
      treeId: node?.treeId || '',
      parentIds: node?.parentIds || [],
      order: newOrderArray,
    };
    onSave(newNode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent "Enter" from submitting the form if focus is inside Jspreadsheet
    if (e.key === 'Enter') {
      const activeElement = document.activeElement as HTMLElement;
      if (
        activeElement &&
        (activeElement.closest('.dsg-container') ||
          activeElement.closest('.ds-grid-container'))
      ) {
        e.preventDefault();
      }
    }
  };



  const renderLinkField = (field: Field) => {
    const value = formData[field.id] || "";
    if (typeof value === 'string' && value.startsWith('node://')) {
      const nodeId = value.substring(7);
      const linkedNodeInfo = findNodeAndParent(nodeId);
      return (
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!linkedNodeInfo}
            onClick={() => {
              onClose();
              setDialogState({ isExplorerOpen: true, nodeIdsForExplorer: [nodeId] });
            }}
          >
            <Link className="mr-2 h-4 w-4" /> Go to Node
          </Button>
        </div>
      );
    }
    return <Input type="url" placeholder="https://example.com" value={value} onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })} />;
  };

  const handleDataChange = useCallback((fieldId: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  }, []);

  const { setIgnoreClicksUntil } = useUIContext();

  const handleClose = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIgnoreClicksUntil(Date.now() + 100);
    onClose();
  };

  return (
    <>
      <form onSubmit={handleSubmit} onKeyDown={(e) => {
        // Prevent all keyboard events from bubbling up to the window
        // where global tree shortcuts are listening
        e.stopPropagation();
        handleKeyDown(e);
      }}>
        <div className="space-y-4 p-1 max-h-[60vh] overflow-y-auto">
          {!isMultiEdit && node?.id && (node.createdAt || node.updatedAt) && (
            <div className="text-xs text-muted-foreground space-y-1">
              {node.createdAt && (
                <p>Created: {formatDate(node.createdAt, `${currentUser?.dateFormat || 'dd/MM/yyyy'} p`)}</p>
              )}
              {node.updatedAt && (
                <p>Last Modified: {formatDate(node.updatedAt, `${currentUser?.dateFormat || 'dd/MM/yyyy'} p`)}</p>
              )}
            </div>
          )}
          {isMultiEdit && (
            <div className="p-3 bg-accent/50 border border-accent rounded-md text-sm text-accent-foreground">
              You are editing {node?.id ? 1 : 'multiple'} nodes. Only the fields you fill out will be updated on the selected nodes.
            </div>
          )}
          {template.fields.map((field, fieldIndex) => {
            let renderedContent = null;
            const plugin = FieldRegistry.get(field.type);
            if (plugin?.EditorComponent) {
              const Editor = plugin.EditorComponent;
              renderedContent = <Editor field={field} value={formData[field.id]} onChange={(v) => handleDataChange(field.id, v)} />;
            }
            if (!renderedContent) {
              switch (field.type) {
                case 'text':
                  renderedContent = <Input value={formData[field.id] || ""} onChange={(e) => handleDataChange(field.id, e.target.value)} />;
                  break;
                case 'textarea':
                  renderedContent = <Textarea value={formData[field.id] || ""} onChange={(e) => handleDataChange(field.id, e.target.value)} />;
                  break;
                case 'number':
                  renderedContent = <Input type="number" step="any" onWheel={(e) => e.currentTarget.blur()} value={formData[field.id] || ""} onChange={(e) => handleDataChange(field.id, e.target.value)} />;
                  break;
                case 'date': {
                  const dateString = formData[field.id];
                  let dateValue: Date | undefined;
                  if (dateString && typeof dateString === 'string') {
                    const parsedDate = parse(dateString, 'yyyy-MM-dd', new Date());
                    if (isValid(parsedDate)) dateValue = parsedDate;
                  }
                  renderedContent = <DatePicker date={dateValue} setDate={(d) => handleDataChange(field.id, d)} placeholder="Select a date" />;
                  break;
                }
                case 'dropdown':
                  renderedContent = (
                    <Select value={formData[field.id]} onValueChange={(value) => handleDataChange(field.id, value)}>
                      <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
                      <SelectContent>{(field.options || []).filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  );
                  break;
                case 'dynamic-dropdown':
                  renderedContent = (
                    <Combobox
                      options={getDynamicOptions(field.id, template.id)}
                      value={formData[field.id] || ""}
                      onChange={(value) => handleDataChange(field.id, value)}
                      placeholder={`Select ${field.name}...`}
                      searchPlaceholder={`Search ${field.name}...`}
                      emptyPlaceholder={`No ${field.name} found.`}
                    />
                  );
                  break;
                case 'link':
                  renderedContent = renderLinkField(field);
                  break;
              }
            }

            if (field.type === 'checkbox') {
              return (
                <div key={field.id} className="space-y-2">
                  <div className="flex items-center space-x-2 pt-2 h-10">
                    <Checkbox id={`form-${field.id}`} checked={!!formData[field.id]} onCheckedChange={(checked) => handleDataChange(field.id, !!checked)} />
                    <Label htmlFor={`form-${field.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{field.name}</Label>
                  </div>
                </div>
              );
            }

            if (field.type === 'query') {
              const handleQueryChange = (value: any) => handleDataChange(field.id, value);
              return <QueryBuilder key={field.id} field={field} value={formData[field.id]} onChange={handleQueryChange} />;
            }
            if (field.type === 'table-header') {
              if (fieldIndex > 0 && template.fields[fieldIndex - 1].type === 'table-header') return null;

              const tableRowCount = getTableRowCount();
              return (
                <div key="table-block" className="space-y-2">
                  <Label className="text-sm font-medium">Table Data</Label>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {tableHeaderFields.map(f => (
                            <TableHead key={f.id} className="min-w-[150px]">{f.name}</TableHead>
                          ))}
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.from({ length: tableRowCount }).map((_, rowIndex) => (
                          <TableRow key={rowIndex}>
                            {tableHeaderFields.map(f => {
                              const dateString = formData[f.id]?.[rowIndex]; let dateValue: Date | undefined;
                              if (dateString && typeof dateString === 'string') { const parsed = parse(dateString, 'yyyy-MM-dd', new Date()); if (isValid(parsed)) dateValue = parsed; }
                              return (
                                <TableCell key={`${f.id}-${rowIndex}`} className="p-2">
                                  <div className="flex items-center gap-1">
                                    {f.prefix && <span className="text-muted-foreground text-sm">{f.prefix}</span>}
                                    {f.columnType === 'date' ? (<DatePicker date={dateValue} setDate={(d) => handleTableChange(rowIndex, f.id, d)} placeholder="Select a date" />) : (<Input type={f.columnType || 'text'} step={f.columnType === 'number' ? "any" : undefined} onWheel={f.columnType === 'number' ? (e) => e.currentTarget.blur() : undefined} value={formData[f.id]?.[rowIndex] || ''} onChange={e => handleTableChange(rowIndex, f.id, e.target.value)} className="h-8 flex-grow min-w-[100px]" />)}
                                    {f.postfix && <span className="text-muted-foreground text-sm">{f.postfix}</span>}
                                  </div>
                                </TableCell>
                              )
                            })}
                            <TableCell className="p-2">
                              <AlertDialog><AlertDialogTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive h-8 w-8"><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the entire row.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRemoveRow(rowIndex)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddRow} className="mt-2"><PlusCircle className="mr-2 h-4 w-4" /> Add Row</Button>
                </div>
              );
            }
            if (renderedContent) {
              return (
                <div key={field.id} className="space-y-2">
                  <Label className="text-sm font-medium">{field.name}</Label>
                  <div className="flex items-center gap-1">
                    {field.prefix && <span className="text-muted-foreground text-sm">{field.prefix}</span>}
                    <div className="flex-grow">{renderedContent}</div>
                    {field.postfix && <span className="text-muted-foreground text-sm">{field.postfix}</span>}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit">{isMultiEdit ? `Update ${node?.id ? 1 : 'nodes'}` : 'Save'}</Button>
        </DialogFooter>
      </form>
    </>
  );
};


const QueryBuilder = React.memo(({ field, value, onChange }: { field: Field, value: any, onChange: (value: any) => void }) => {
  const { getTemplateById, templates } = useTreeContext();
  const queryDefs: QueryDefinition[] = Array.isArray(value) ? value : [];

  const handleQueryChange = (newDefs: QueryDefinition[]) => {
    onChange(newDefs);
  };

  const handleQueryGroupChange = (queryIndex: number, key: keyof Omit<QueryDefinition, 'id'>, value: any) => {
    const newQueryDefs = [...queryDefs];
    newQueryDefs[queryIndex] = { ...newQueryDefs[queryIndex], [key]: value };
    handleQueryChange(newQueryDefs);
  };

  const handleRuleChange = (queryIndex: number, ruleIndex: number, key: keyof QueryRule, value: any) => {
    const newQueryDefs = [...queryDefs];
    const newRules = [...newQueryDefs[queryIndex].rules];
    newRules[ruleIndex] = { ...newRules[ruleIndex], [key]: value };
    if (key === 'type') {
      if (value === 'field') {
        delete newRules[ruleIndex].relationTemplateId;
        delete newRules[ruleIndex].relationRules;
      } else {
        delete newRules[ruleIndex].fieldId;
        delete newRules[ruleIndex].operator;
        delete newRules[ruleIndex].value;
      }
    }
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const addQueryGroup = () => {
    handleQueryChange([...queryDefs, { id: generateClientSideId(), targetTemplateId: null, rules: [] }]);
  };

  const removeQueryGroup = (queryIndex: number) => {
    handleQueryChange(queryDefs.filter((_, index) => index !== queryIndex));
  };

  const addRule = (queryIndex: number) => {
    const newRules = [...(queryDefs[queryIndex].rules || []), { id: generateClientSideId(), type: 'field', fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const removeRule = (queryIndex: number, ruleIndex: number) => {
    const newRules = (queryDefs[queryIndex].rules || []).filter((_, index) => index !== ruleIndex);
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const handleRelationRuleChange = (queryIndex: number, ruleIndex: number, relationRuleIndex: number, key: keyof SimpleQueryRule, value: any) => {
    const newQueryDefs = [...queryDefs];
    const newRules = [...newQueryDefs[queryIndex].rules];
    const newRelationRules = [...(newRules[ruleIndex].relationRules || [])];
    newRelationRules[relationRuleIndex] = { ...newRelationRules[relationRuleIndex], [key]: value };
    newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const addRelationRule = (queryIndex: number, ruleIndex: number) => {
    const newQueryDefs = [...queryDefs];
    const newRules = [...newQueryDefs[queryIndex].rules];
    const newRelationRules = [...(newRules[ruleIndex].relationRules || []), { id: generateClientSideId(), fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
    newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const removeRelationRule = (queryIndex: number, ruleIndex: number, relationRuleIndex: number) => {
    const newQueryDefs = [...queryDefs];
    const newRules = [...newQueryDefs[queryIndex].rules];
    const newRelationRules = (newRules[ruleIndex].relationRules || []).filter((_, index) => index !== relationRuleIndex);
    newRules[ruleIndex] = { ...newRules[ruleIndex], relationRules: newRelationRules };
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  return (
    <div key={field.id} className="space-y-2">
      <Label className="text-sm font-medium">{field.name}</Label>
      <div className="space-y-4">
        {queryDefs.map((queryDef, queryIndex) => {
          const targetTemplate = templates.find(t => t.id === queryDef.targetTemplateId);
          return (
            <Card key={queryDef.id || queryIndex} className="bg-muted/50 p-4 space-y-4">
              <div className="flex justify-between items-center">
                <Label>Search for nodes with template:</Label>
                <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeQueryGroup(queryIndex)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Select value={queryDef.targetTemplateId || ''} onValueChange={(val) => handleQueryGroupChange(queryIndex, 'targetTemplateId', val)}>
                <SelectTrigger><SelectValue placeholder="Select a template..." /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="space-y-2">
                <Label>Where...</Label>
                {(queryDef.rules || []).map((rule, ruleIndex) => {
                  const ruleType = rule.type || 'field';
                  const relationTemplate = rule.relationTemplateId ? getTemplateById(rule.relationTemplateId) : null;
                  return (
                    <Card key={rule.id || ruleIndex} className="p-2 bg-background space-y-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Select value={ruleType} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'type', val)}>
                            <SelectTrigger className="w-auto"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="field">Field</SelectItem>
                              <SelectItem value="ancestor">Ancestor</SelectItem>
                              <SelectItem value="descendant">Descendant</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRule(queryIndex, ruleIndex)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {ruleType === 'field' ? (
                          <div className="space-y-2 pl-2">
                            <Select value={rule.fieldId || ''} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'fieldId', val)} disabled={!targetTemplate}>
                              <SelectTrigger><SelectValue placeholder="Field..." /></SelectTrigger>
                              <SelectContent>
                                {targetTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={rule.operator || 'equals'} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'operator', val)}>
                              <SelectTrigger><SelectValue placeholder="Operator..." /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(operatorLabels).map(([op, label]) => <SelectItem key={op} value={op}>{label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Input value={rule.value || ''} onChange={(e) => handleRuleChange(queryIndex, ruleIndex, 'value', e.target.value)} placeholder="Value..." />
                          </div>
                        ) : (
                          <div className="space-y-2 pl-2">
                            <span className="text-sm p-2 block">has {ruleType} with template:</span>
                            <Select value={rule.relationTemplateId || ''} onValueChange={(val) => handleRuleChange(queryIndex, ruleIndex, 'relationTemplateId', val)}>
                              <SelectTrigger><SelectValue placeholder="Template..." /></SelectTrigger>
                              <SelectContent>
                                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      {(ruleType === 'ancestor' || ruleType === 'descendant') && rule.relationTemplateId && (
                        <div className="pl-6 space-y-2">
                          <Label className="text-xs text-muted-foreground">Where...</Label>
                          {(rule.relationRules || []).map((relRule, relRuleIndex) => (
                            <Card key={relRule.id} className="p-2 bg-muted/50">
                              <div className="space-y-2">
                                <Select value={relRule.fieldId} onValueChange={(val) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'fieldId', val)}>
                                  <SelectTrigger><SelectValue placeholder="Field..." /></SelectTrigger>
                                  <SelectContent>{relationTemplate?.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                                </Select>
                                <Select value={relRule.operator} onValueChange={(val) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'operator', val)}>
                                  <SelectTrigger><SelectValue placeholder="Operator..." /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(operatorLabels).map(([op, label]) => <SelectItem key={op} value={op}>{label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Input value={relRule.value} onChange={(e) => handleRelationRuleChange(queryIndex, ruleIndex, relRuleIndex, 'value', e.target.value)} placeholder="Value..." />
                                <div className="flex justify-end">
                                  <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeRelationRule(queryIndex, ruleIndex, relRuleIndex)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                          <Button type="button" variant="outline" size="sm" onClick={() => addRelationRule(queryIndex, ruleIndex)}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Add condition for {ruleType}
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
                <Button type="button" variant="outline" size="sm" onClick={() => addRule(queryIndex)} disabled={!targetTemplate}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Add AND Condition
                </Button>
              </div>
            </Card>
          )
        })}
        <Button type="button" variant="outline" className="w-full" onClick={addQueryGroup}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add OR Condition
        </Button>
      </div>
    </div>
  );
});
QueryBuilder.displayName = "QueryBuilder";


