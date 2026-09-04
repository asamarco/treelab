"use client";

import React, { useCallback, useMemo } from 'react';
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { Grid3X3 } from 'lucide-react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spreadsheet } from '@/components/ui/spreadsheet';
import { cn } from '@/lib/utils';
import { TreeNode, Field } from '@/lib/types';
import { useTreeContext } from '@/contexts/tree-context';

const SpreadsheetDesignerSettings = ({ form, index }: { form: any, index: number }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <FormField
            control={form.control}
            name={`fields.${index}.spreadsheetRowCount`}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Number of Rows</FormLabel>
                    <FormControl>
                        <Input
                            type="number"
                            placeholder="Default: 3"
                            {...field}
                            value={field.value || ""}
                            onChange={(e) => field.onChange(parseInt(e.target.value, 10) || undefined)}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
        <FormField
            control={form.control}
            name={`fields.${index}.spreadsheetColumnCount`}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Number of Columns</FormLabel>
                    <FormControl>
                        <Input
                            type="number"
                            placeholder="Default: 3"
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
);

const SpreadsheetEditorComponent = React.memo(({ field, value, onChange }: { field: Field, value: any, onChange: (value: any) => void }) => {
    const targetRows = field.spreadsheetRowCount || 3;
    const targetCols = field.spreadsheetColumnCount || 3;
    const existingData: { value: string }[][] = value || [];

    const currentRows = existingData.length > 0 ? existingData.length : targetRows;
    const currentCols = existingData.length > 0 && existingData[0] ? existingData[0].length : targetCols;

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Spreadsheet data can be edited directly from the tree view. Here you can adjust its dimensions. Formula reference can be found <a href="https://jspreadsheet.com/docs/formulas/functions" target="_blank" rel="noopener noreferrer" className="underline">here</a>.
            </p>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Number of Rows</Label>
                    <Input
                        type="number"
                        min={1}
                        value={currentRows}
                        onChange={(e) => {
                            const newRows = parseInt(e.target.value, 10) || 1;
                            const newData = Array.from({ length: newRows }, (_, r) => {
                                return Array.from({ length: currentCols }, (_, c) => {
                                    return { value: existingData?.[r]?.[c]?.value || '' };
                                });
                            });
                            onChange(newData);
                        }}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Number of Columns</Label>
                    <Input
                        type="number"
                        min={1}
                        value={currentCols}
                        onChange={(e) => {
                            const newCols = parseInt(e.target.value, 10) || 1;
                            const newData = Array.from({ length: currentRows }, (_, r) => {
                                return Array.from({ length: newCols }, (_, c) => {
                                    return { value: existingData?.[r]?.[c]?.value || '' };
                                });
                            });
                            onChange(newData);
                        }}
                    />
                </div>
            </div>
        </div>
    );
});
SpreadsheetEditorComponent.displayName = "SpreadsheetEditorComponent";

const SpreadsheetViewerComponent = ({ field, value, node, readOnly, isCompactView }: any) => {
    const { updateNode } = useTreeContext();

    const initialData = useMemo(() => {
        const data: { value: string }[][] = value || [[{ value: '' }]];
        const targetRows = field.spreadsheetRowCount || 3;
        const targetCols = field.spreadsheetColumnCount || 3;

        const maxRows = Math.max(data.length, targetRows);
        const maxCols = Math.max(data[0]?.length || 0, targetCols);

        return Array.from({ length: maxRows }, (_, rIndex) => {
            return Array.from({ length: maxCols }, (_, cIndex) => {
                return data?.[rIndex]?.[cIndex]?.value || '';
            });
        });
    }, [value, field.spreadsheetRowCount, field.spreadsheetColumnCount]);

    const handleChange = useCallback((newDataRaw: any[][]) => {
        if (readOnly || !updateNode || !Array.isArray(newDataRaw)) return;

        const formattedData = newDataRaw.map((row: any[]) => {
            if (!Array.isArray(row)) return [];
            return row.map(cellValue => ({ value: String(cellValue ?? '') }));
        });

        const newTotalData = {
            ...node.data,
            [field.id]: formattedData,
        };
        updateNode(node.id, { data: newTotalData });
    }, [node.id, node.data, field.id, readOnly, updateNode]);

    const minDimensions = useMemo<[number, number]>(() => [
        field.spreadsheetColumnCount || 3,
        field.spreadsheetRowCount || 3
    ], [field.spreadsheetColumnCount, field.spreadsheetRowCount]);

    return (
        <div
            className="mt-2 text-sm min-w-0"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <p className={cn("font-medium mb-1", isCompactView ? "text-xs" : "text-sm")}>
                {field.name}
            </p>
            <div className={cn(
                "rounded-md border w-full bg-background overflow-x-auto",
                readOnly && "opacity-80 pointer-events-none"
            )}>
                <Spreadsheet
                    data={initialData}
                    minDimensions={minDimensions}
                    readOnly={readOnly}
                    onChange={handleChange}
                />
            </div>
        </div>
    );
};

export const SpreadsheetPlugin: FieldTypePlugin = {
    type: "spreadsheet",
    label: "Spreadsheet",
    icon: Grid3X3,
    DesignerSettings: SpreadsheetDesignerSettings,
    EditorComponent: SpreadsheetEditorComponent,
    ViewerComponent: SpreadsheetViewerComponent,
};
