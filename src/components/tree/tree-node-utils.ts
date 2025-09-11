/**
 * @fileoverview
 * This file contains utility functions related to tree node rendering and logic,
 * shared between different tree node components.
 */

import { TreeNode, Template, ConditionalRuleOperator } from "@/lib/types";

const evaluateCondition = (
  operator: ConditionalRuleOperator,
  fieldValue: any,
  ruleValue: string
): boolean => {
  const fv = String(fieldValue ?? '').toLowerCase();
  const rv = ruleValue.toLowerCase();

  switch (operator) {
    case 'equals': return fv === rv;
    case 'not_equals': return fv !== rv;
    case 'contains': return fv.includes(rv);
    case 'not_contains': return !fv.includes(rv);
    case 'is_not_empty': return fv.length > 0;
    case 'is_empty': return fv.length === 0;
    case 'greater_than': {
      const numFv = parseFloat(fv);
      const numRv = parseFloat(rv);
      return !isNaN(numFv) && !isNaN(numRv) && numFv > numRv;
    }
    case 'less_than': {
      const numFv = parseFloat(fv);
      const numRv = parseFloat(rv);
      return !isNaN(numFv) && !isNaN(numRv) && numFv < numRv;
    }
    default: return false;
  }
};

export const getConditionalStyle = (targetNode: TreeNode, targetTemplate: Template | undefined) => {
  if (!targetTemplate || !targetTemplate.conditionalRules) {
    return { icon: targetTemplate?.icon, color: targetTemplate?.color };
  }
  
  const nodeData = targetNode.data || {};

  for (const rule of targetTemplate.conditionalRules) {
    const fieldValue = nodeData[rule.fieldId];
    if (evaluateCondition(rule.operator, fieldValue, rule.value)) {
      return { icon: rule.icon, color: rule.color };
    }
  }
  return { icon: targetTemplate.icon, color: targetTemplate.color };
};

export const hasAttachments = (node: TreeNode, template: Template): boolean => {
  if (!template) return false;
  const nodeData = node.data || {};
  for (const field of template.fields) {
    if (field.type === 'picture' || field.type === 'attachment') {
      const value = nodeData[field.id];
      if (value && Array.isArray(value) && value.length > 0) {
        return true;
      }
      if (field.type === 'picture' && typeof value === 'string' && value) {
        return true;
      }
    }
  }
  return false;
};
