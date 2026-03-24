'use client';

import React, { useCallback, useMemo } from 'react';
import { Spreadsheet } from '../ui/spreadsheet';
import { cn } from '@/lib/utils';
import { TreeNode } from '@/lib/types';

interface TreeSpreadsheetFieldProps {
    field: any;
    value: any;
    node: TreeNode;
    isCompactView: boolean;
    readOnly: boolean;
    updateNode?: (nodeId: string, updates: Partial<TreeNode>) => Promise<void>;
}

export function TreeSpreadsheetField({ 
    field, 
    value, 
    node, 
    isCompactView, 
    readOnly, 
    updateNode 
}: TreeSpreadsheetFieldProps) {
    
    // Convert database format [{ value: string }][] to flat array string[][]
    const initialData = useMemo(() => {
        const data: { value: string }[][] = value || [[{ value: '' }]];
        const targetRows = field.spreadsheetRowCount || 5;
        const targetCols = field.spreadsheetColumnCount || 5;

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
        field.spreadsheetColumnCount || 5,
        field.spreadsheetRowCount || 5
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
}
