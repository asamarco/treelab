import { TreeNode, Field, Template } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { QUERY_COLUMN_FIELD_TYPES } from "./constants";
import { getColumnMergeKey } from "./merge-templates";

/** Format a cell value for a given field of a result node. */
export function formatCellValue(resultNode: TreeNode, colField: Field, dateFormat?: string): string {
    if (colField.id === '__createdAt') {
        return resultNode.createdAt ? formatDate(resultNode.createdAt, dateFormat) : '';
    }
    if (colField.id === '__updatedAt') {
        return resultNode.updatedAt ? formatDate(resultNode.updatedAt, dateFormat) : '';
    }
    const cellRaw = resultNode.data?.[colField.id];
    if (colField.type === 'checkbox') {
        return cellRaw ? '✓' : '';
    }
    if (colField.type === 'date') {
        return cellRaw ? formatDate(cellRaw, dateFormat) : '';
    }
    if (colField.type === 'table-header') {
        // table-header stores an array; format each entry with prefix/postfix and date formatting
        if (!Array.isArray(cellRaw)) return '';
        return cellRaw.map((entry: string) => {
            let v = entry || '';
            if (colField.columnType === 'date' && v) {
                v = formatDate(v, dateFormat);
            }
            if (v) v = `${colField.prefix || ''}${v}${colField.postfix || ''}`;
            return v;
        }).filter(Boolean).join(', ');
    }
    // text, number, textarea, link, dropdown, dynamic-dropdown: raw string
    return cellRaw != null ? String(cellRaw) : '';
}

/**
 * Format a merged-column cell value for a given row.
 *
 * For a merged table a column is identified by its merge key.
 * This function looks up the field in the row's own template that matches the merged
 * column's merge key, then delegates to formatCellValue.
 * Returns "–" (em dash) when the row's template has no matching field for the column.
 */
export function formatMergedCellValue(
    resultNode: TreeNode,
    colName: string,
    colType: Field['type'],
    getTemplateById: (id: string) => Template | undefined,
    dateFormat?: string,
): string {
    const normName = colName.trim().toLowerCase();

    if (normName === 'created' && colType === 'date') {
        return resultNode.createdAt ? formatDate(resultNode.createdAt, dateFormat) : '';
    }
    if (normName === 'last edited' && colType === 'date') {
        return resultNode.updatedAt ? formatDate(resultNode.updatedAt, dateFormat) : '';
    }

    const tpl = getTemplateById(resultNode.templateId);
    if (!tpl) return '–';

    const targetKey = getColumnMergeKey(colName, colType);

    const matchingField = tpl.fields.find(
        f =>
            QUERY_COLUMN_FIELD_TYPES.includes(f.type) &&
            getColumnMergeKey(f.name, f.type) === targetKey,
    );

    if (!matchingField) return '–';
    return formatCellValue(resultNode, matchingField, dateFormat);
}
