import { Field } from "@/lib/types";

export const operatorLabels: Record<string, string> = {
    equals: 'Equals',
    not_equals: 'Not Equals',
    contains: 'Contains',
    not_contains: 'Does Not Contain',
    is_not_empty: 'Is Not Empty',
    is_empty: 'Is Empty',
    greater_than: 'Greater Than',
    less_than: 'Less Than',
};

/** Field types eligible as query result table columns. */
export const QUERY_COLUMN_FIELD_TYPES: Field['type'][] = [
    'text', 'number', 'date', 'dropdown', 'textarea', 'link', 'dynamic-dropdown', 'checkbox',
    'table-header',
];

export const VIRTUAL_QUERY_COLUMNS: { id: string; name: string; type: Field['type'] }[] = [
    { id: '__createdAt', name: 'Created', type: 'date' },
    { id: '__updatedAt', name: 'Last Edited', type: 'date' },
];

export const QUERY_PAGE_SIZE = 25;
