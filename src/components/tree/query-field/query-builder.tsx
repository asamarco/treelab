import React from "react";
import { Trash2, PlusCircle } from "lucide-react";
import { Field, QueryDefinition, QueryRule, SimpleQueryRule, ConditionalRuleOperator, QueryFieldValue, normalizeQueryFieldValue } from "@/lib/types";
import { useTreeContext } from "@/contexts/tree-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, generateClientSideId } from "@/lib/utils";
import { operatorLabels, QUERY_COLUMN_FIELD_TYPES, VIRTUAL_QUERY_COLUMNS } from "./constants";

export interface QueryRulesEditorProps {
    queryDefs: QueryDefinition[];
    onChange: (queryDefs: QueryDefinition[]) => void;
    renderGroupFooter?: (queryDef: QueryDefinition) => React.ReactNode;
}

export function QueryRulesEditor({ queryDefs, onChange, renderGroupFooter }: QueryRulesEditorProps) {
  const { getTemplateById, templates } = useTreeContext();

  const handleQueryGroupChange = (queryIndex: number, key: keyof Omit<QueryDefinition, 'id'>, val: any) => {
    const newQueryDefs = [...queryDefs];
    newQueryDefs[queryIndex] = { ...newQueryDefs[queryIndex], [key]: val };
    onChange(newQueryDefs);
  };

  const handleRuleChange = (queryIndex: number, ruleIndex: number, key: keyof QueryRule, val: any) => {
    const newQueryDefs = [...queryDefs];
    const newRules = [...newQueryDefs[queryIndex].rules];
    newRules[ruleIndex] = { ...newRules[ruleIndex], [key]: val };
    if (key === 'type') {
      if (val === 'field') {
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
    onChange([...queryDefs, { id: generateClientSideId(), targetTemplateId: null, rules: [] }]);
  };

  const removeQueryGroup = (queryIndex: number) => {
    onChange(queryDefs.filter((_, index) => index !== queryIndex));
  };

  const addRule = (queryIndex: number) => {
    const newRules = [...(queryDefs[queryIndex].rules || []), { id: generateClientSideId(), type: 'field', fieldId: '', operator: 'equals' as ConditionalRuleOperator, value: '' }];
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const removeRule = (queryIndex: number, ruleIndex: number) => {
    const newRules = (queryDefs[queryIndex].rules || []).filter((_, index) => index !== ruleIndex);
    handleQueryGroupChange(queryIndex, 'rules', newRules);
  };

  const handleRelationRuleChange = (queryIndex: number, ruleIndex: number, relationRuleIndex: number, key: keyof SimpleQueryRule, val: any) => {
    const newQueryDefs = [...queryDefs];
    const newRules = [...newQueryDefs[queryIndex].rules];
    const newRelationRules = [...(newRules[ruleIndex].relationRules || [])];
    newRelationRules[relationRuleIndex] = { ...newRelationRules[relationRuleIndex], [key]: val };
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

            {renderGroupFooter?.(queryDef)}
          </Card>
        );
      })}
      <Button type="button" variant="outline" className="w-full" onClick={addQueryGroup}>
        <PlusCircle className="mr-2 h-4 w-4" /> Add OR Condition
      </Button>
    </div>
  );
}

export const QueryBuilder = React.memo(({ field, value, onChange }: { field: Field, value: any, onChange: (value: any) => void }) => {
  const { templates } = useTreeContext();

  // Normalize once on render so both old (bare array) and new shapes work.
  const fieldValue: QueryFieldValue = normalizeQueryFieldValue(value);
  const queryDefs = fieldValue.queries;
  const displayColumns = fieldValue.displayColumns;

  /**
   * Toggle a column field id in displayColumns[templateId].
   * Multiple query groups that share the same targetTemplateId share one entry.
   */
  const handleColumnToggle = (templateId: string, fieldId: string) => {
    const current = displayColumns[templateId] || [];
    const next = current.includes(fieldId)
      ? current.filter(id => id !== fieldId)
      : [...current, fieldId];
    onChange({ queries: queryDefs, displayColumns: { ...displayColumns, [templateId]: next } });
  };

  const renderColumnPicker = (queryDef: QueryDefinition) => {
    const targetTemplate = templates.find(t => t.id === queryDef.targetTemplateId);
    if (!queryDef.targetTemplateId || !targetTemplate) return null;

    const nativeFields = targetTemplate.fields.filter(f => QUERY_COLUMN_FIELD_TYPES.includes(f.type));
    const selectedCols = displayColumns[queryDef.targetTemplateId] || [];

    return (
      <div className="space-y-2 pt-2 border-t border-border/40">
        <Label className="text-xs font-medium text-muted-foreground">Display columns for {targetTemplate.name} results:</Label>
        <div className="flex flex-wrap gap-2">
          {VIRTUAL_QUERY_COLUMNS.map(vCol => {
            const isSelected = selectedCols.includes(vCol.id);
            return (
              <button
                key={vCol.id}
                type="button"
                onClick={() => handleColumnToggle(queryDef.targetTemplateId!, vCol.id)}
                className={cn(
                  'text-xs px-2 py-1 rounded border transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-accent'
                )}
              >
                {vCol.name}
              </button>
            );
          })}
          {nativeFields.map(f => {
            const isSelected = selectedCols.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => handleColumnToggle(queryDef.targetTemplateId!, f.id)}
                className={cn(
                  'text-xs px-2 py-1 rounded border transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-accent'
                )}
              >
                {f.name}
              </button>
            );
          })}
        </div>
        {selectedCols.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Column order: {selectedCols.map(id => VIRTUAL_QUERY_COLUMNS.find(v => v.id === id)?.name ?? nativeFields.find(f => f.id === id)?.name ?? id).join(' → ')}
          </p>
        )}
      </div>
    );
  };

  return (
    <QueryRulesEditor
      queryDefs={queryDefs}
      onChange={(newDefs) => onChange({ queries: newDefs, displayColumns })}
      renderGroupFooter={renderColumnPicker}
    />
  );
});
QueryBuilder.displayName = "QueryBuilder";
