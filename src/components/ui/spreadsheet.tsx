'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import jspreadsheet from 'jspreadsheet-ce';
import { HyperFormula } from 'hyperformula';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';

interface SpreadsheetProps {
    data: any[][];
    columns?: any[];
    minDimensions?: [number, number];
    defaultColWidth?: number;
    readOnly?: boolean;
    onChange?: (data: any[][]) => void;
    onRowChange?: (type: 'insert' | 'delete', index: number, amount: number) => void;
    onColChange?: (type: 'insert' | 'delete', index: number, amount: number) => void;
    className?: string;
}

export function Spreadsheet({
    data,
    columns,
    minDimensions = [5, 5],
    defaultColWidth = 125,
    readOnly = false,
    onChange,
    onRowChange,
    onColChange,
    className,
}: SpreadsheetProps) {
    const spreadsheetRef = useRef<HTMLDivElement>(null);
    const jRef = useRef<any>(null);
    const hfRef = useRef<any>(null);
    const sheetIdRef = useRef<number>(0);

    // Initialize HyperFormula once
    if (!hfRef.current) {
        hfRef.current = HyperFormula.buildEmpty({
            licenseKey: 'gpl-v3',
        });
        const sheetName = hfRef.current.addSheet('Sheet1');
        sheetIdRef.current = hfRef.current.getSheetId(sheetName);
    }

    const handleSync = useCallback((instance: any, x: number, y: number, value: any) => {
        if (instance.jspreadsheet.ignoreEvents) return;
        if (!hfRef.current) return;

        const changes = hfRef.current.setCellContents(
            { sheet: sheetIdRef.current, col: x, row: y },
            value
        );

        if (changes.length > 0) {
            instance.jspreadsheet.ignoreEvents = true;
            changes.forEach((change: any) => {
                const col = change.address.col;
                const row = change.address.row;
                const currentRawValue = instance.jspreadsheet.getValueFromCoords(col, row);

                if (typeof currentRawValue === 'string' && currentRawValue.startsWith('=')) {
                    instance.jspreadsheet.setValueFromCoords(col, row, currentRawValue, true);
                } else if (col !== x || row !== y) {
                    instance.jspreadsheet.setValueFromCoords(col, row, change.newValue, true);
                }
            });
            instance.jspreadsheet.ignoreEvents = false;
        }

        if (onChange) {
            onChange(instance.jspreadsheet.getData());
        }
    }, [onChange]);

    useEffect(() => {
        if (!spreadsheetRef.current || jRef.current) return;

        try {
            // Defensive check for the jspreadsheet library itself
            const jss: any = (jspreadsheet as any).default || jspreadsheet;
            if (typeof jss !== 'function') {
                console.error('[Spreadsheet] jspreadsheet-ce is not a function:', jss);
                return;
            }

            const options: any = {
                data: [['']], // Safe initial empty data to avoid crash and CSP eval
                minDimensions: minDimensions || [5, 5],
                defaultColWidth: defaultColWidth,
                wordWrap: true,
                editable: !readOnly,
                allowInsertColumn: !readOnly,
                allowDeleteColumn: !readOnly,
                allowInsertRow: !readOnly,
                allowDeleteRow: !readOnly,
                contextMenu: !readOnly ? undefined : () => [],
                onchange: (instance: any, cell: any, x: number | string, y: number | string, value: any) => {
                    handleSync(instance, Number(x), Number(y), value);
                },
                oninsertrow: (instance: any, rowIndex: number | string, numOfRows: number | string) => {
                    hfRef.current?.addRows(sheetIdRef.current, [Number(rowIndex), Number(numOfRows)]);
                    if (onRowChange) onRowChange('insert', Number(rowIndex), Number(numOfRows));
                    if (onChange) onChange(instance.jspreadsheet.getData());
                },
                ondeleterow: (instance: any, rowIndex: number | string, numOfRows: number | string) => {
                    hfRef.current?.removeRows(sheetIdRef.current, [Number(rowIndex), Number(numOfRows)]);
                    if (onRowChange) onRowChange('delete', Number(rowIndex), Number(numOfRows));
                    if (onChange) onChange(instance.jspreadsheet.getData());
                },
                oninsertcolumn: (instance: any, colIndex: number | string, numOfColumns: number | string) => {
                    hfRef.current?.addColumns(sheetIdRef.current, [Number(colIndex), Number(numOfColumns)]);
                    if (onColChange) onColChange('insert', Number(colIndex), Number(numOfColumns));
                    if (onChange) onChange(instance.jspreadsheet.getData());
                },
                ondeletecolumn: (instance: any, colIndex: number | string, numOfColumns: number | string) => {
                    hfRef.current?.removeColumns(sheetIdRef.current, [Number(colIndex), Number(numOfColumns)]);
                    if (onColChange) onColChange('delete', Number(colIndex), Number(numOfColumns));
                    if (onChange) onChange(instance.jspreadsheet.getData());
                },
            };

            if (Array.isArray(columns) && columns.length > 0) {
                options.columns = columns;
            }

            const el = jss(spreadsheetRef.current, options);
            if (!el) {
                console.error('[Spreadsheet] Failed to initialize jspreadsheet instance');
                return;
            }

            // Sync HF
            if (hfRef.current) {
                hfRef.current.setCellContents({ sheet: sheetIdRef.current, row: 0, col: 0 }, data);
            }

            // Override engine
            const obj = el.jexcel || el;
            obj.executeFormula = (expression: string, x: number, y: number) => {
                if (expression && expression[0] === '=' && hfRef.current) {
                    try {
                        const result = hfRef.current.calculateFormula(expression, sheetIdRef.current);
                        if (Array.isArray(result)) return result[0][0];
                        return result;
                    } catch (e) {
                        return '#ERROR!';
                    }
                }
                return '';
            };

            obj.setData(data);
            jRef.current = el;

            // --- Clipboard Logic: Always copy calculated values ---
            const handleCopy = (e: ClipboardEvent) => {
                const activeEl = document.activeElement;
                if (!activeEl || !activeEl.classList.contains('jexcel_textarea')) return;
                
                const selectedRange = obj.selectedCell;
                if (!selectedRange || !e.clipboardData) return;

                const [x1, y1, x2, y2] = selectedRange;
                const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

                const rows = [];
                for (let y = minY; y <= maxY; y++) {
                    const row = [];
                    for (let x = minX; x <= maxX; x++) {
                        const val = hfRef.current ? hfRef.current.getCellValue({ sheet: sheetIdRef.current, col: x, row: y }) : obj.getValueFromCoords(x, y);
                        row.push(val === null || val === undefined ? '' : (typeof val === 'object' && val.error ? (val.message || '#ERROR!') : String(val)));
                    }
                    rows.push(row.join('\t'));
                }

                e.clipboardData.setData('text/plain', rows.join('\n'));
                e.preventDefault(); 
            };

            document.addEventListener('copy', handleCopy);
            (el as any)._handleGlobalCopy = handleCopy;

        } catch (error) {
            console.error('[Spreadsheet] Initialization error:', error);
        }

        return () => {
            if (jRef.current) {
                try {
                    const elDom = spreadsheetRef.current;
                    if (elDom && (elDom as any)._handleGlobalCopy) {
                        document.removeEventListener('copy', (elDom as any)._handleGlobalCopy);
                    }
                    jRef.current.destroy();
                } catch (e) {
                    // Ignore destruction errors
                }
                jRef.current = null;
            }
        };    }, [data, columns, minDimensions, readOnly, handleSync, onRowChange, onColChange, onChange]);

    return (
        <div className={className}>
            <div ref={spreadsheetRef} />
        </div>
    );
}
