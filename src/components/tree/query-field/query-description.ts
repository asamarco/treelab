import { QueryDefinition, Template } from "@/lib/types";
import { operatorLabels } from "./constants";

export function describeQuery(
    queryDefinitions: QueryDefinition[],
    getTemplateById: (id: string) => Template | undefined,
): string {
    const finalQueryStr = queryDefinitions.map(queryDef => {
        const targetTemplate = getTemplateById(queryDef.targetTemplateId || '');
        const targetTemplateName = targetTemplate ? targetTemplate.name : 'any';

        const ruleStrings = (queryDef.rules || []).map(rule => {
            if (rule.type === 'field') {
                const ruleField = targetTemplate?.fields.find(f => f.id === rule.fieldId);
                const fieldName = ruleField ? ruleField.name : rule.fieldId || 'Field';
                const op = operatorLabels[rule.operator || ''] || rule.operator || 'equals';
                const hasNoVal = rule.operator === 'is_empty' || rule.operator === 'is_not_empty';
                return `'${fieldName}' ${op.toLowerCase()}${hasNoVal ? '' : ` '${rule.value || ''}'`}`;
            } else {
                const relTemplate = rule.relationTemplateId ? getTemplateById(rule.relationTemplateId) : null;
                const relTemplateName = relTemplate ? relTemplate.name : 'any';
                const relRulesStr = (rule.relationRules || []).map(relRule => {
                    const relField = relTemplate?.fields.find(f => f.id === relRule.fieldId);
                    const relFieldName = relField ? relField.name : relRule.fieldId || 'Field';
                    const relOp = operatorLabels[relRule.operator || ''] || relRule.operator || 'equals';
                    const relHasNoVal = relRule.operator === 'is_empty' || relRule.operator === 'is_not_empty';
                    return `'${relFieldName}' ${relOp.toLowerCase()}${relHasNoVal ? '' : ` '${relRule.value || ''}'`}`;
                }).join(' AND ');

                const relCond = relRulesStr ? ` where ${relRulesStr}` : '';
                return `has ${rule.type} '${relTemplateName}'${relCond}`;
            }
        });

        const joinedRules = ruleStrings.join(' AND ');
        const rulesPart = ruleStrings.length > 0 ? ` where ${joinedRules}` : '';
        const groupStr = `'${targetTemplateName}' nodes${rulesPart}`;
        return queryDefinitions.length > 1 ? `(${groupStr})` : groupStr;
    }).join(' OR ');

    return finalQueryStr || 'No query defined';
}
