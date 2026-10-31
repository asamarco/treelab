import { Field, Template } from "@/lib/types";
import { QUERY_COLUMN_FIELD_TYPES } from "@/components/tree/query-field/constants";
import { getColumnMergeKey } from "@/components/tree/query-field/merge-templates";

export function findFieldByName(
    template: Template | undefined,
    name: string,
    type: Field["type"],
): Field | undefined {
    if (!template || !name) return undefined;
    const targetKey = getColumnMergeKey(name, type);
    return template.fields.find(f => f.type === type && getColumnMergeKey(f.name, f.type) === targetKey);
}

export function getCardFields(
    template: Template | undefined,
    cardFieldNames: string[],
    excludedFieldIds: string[],
): Field[] {
    if (!template || cardFieldNames.length === 0) return [];
    const result: Field[] = [];
    for (const name of cardFieldNames) {
        const field = template.fields.find(f =>
            !excludedFieldIds.includes(f.id) &&
            QUERY_COLUMN_FIELD_TYPES.includes(f.type) &&
            getColumnMergeKey(f.name, f.type) === getColumnMergeKey(name, f.type),
        );
        if (field && !result.includes(field)) result.push(field);
    }
    return result;
}
