'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import jspreadsheet from 'jspreadsheet-ce';
import { HyperFormula } from 'hyperformula';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';
import { notifySpreadsheetFocusIn, notifySpreadsheetFocusOut } from '@/lib/spreadsheet-focus-state';

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
    const lastDataRef = useRef<any[][] | null>(null);
    // Tracks whether the user has interacted with this spreadsheet (focus is inside)
    const isActiveRef = useRef<boolean>(false);

    // Store callbacks in refs to avoid re-mounting the spreadsheet when they change
    const onChangeRef = useRef(onChange);
    const onRowChangeRef = useRef(onRowChange);
    const onColChangeRef = useRef(onColChange);

    useEffect(() => {
        onChangeRef.current = onChange;
        onRowChangeRef.current = onRowChange;
        onColChangeRef.current = onColChange;
    }, [onChange, onRowChange, onColChange]);

    // Initialize HyperFormula once
    if (!hfRef.current) {
        hfRef.current = HyperFormula.buildEmpty({
            licenseKey: 'gpl-v3',
        });
        const sheetName = hfRef.current.addSheet('Sheet1');
        sheetIdRef.current = hfRef.current.getSheetId(sheetName);
    }

    const handleSync = useCallback((instance: any, x: number, y: number, value: any) => {
        const obj = instance.jspreadsheet || instance;
        if (obj.ignoreEvents) return;
        if (!hfRef.current) return;

        const changes = hfRef.current.setCellContents(
            { sheet: sheetIdRef.current, col: x, row: y },
            value
        );

        if (changes.length > 0) {
            obj.ignoreEvents = true;
            changes.forEach((change: any) => {
                const col = change.address.col;
                const row = change.address.row;
                const currentRawValue = obj.getValueFromCoords(col, row);

                if (typeof currentRawValue === 'string' && currentRawValue.startsWith('=')) {
                    obj.setValueFromCoords(col, row, currentRawValue, true);
                } else if (col !== x || row !== y) {
                    obj.setValueFromCoords(col, row, change.newValue, true);
                }
            });
            obj.ignoreEvents = false;
        }

        if (onChangeRef.current) {
            const currentData = obj.getData();
            lastDataRef.current = currentData;
            onChangeRef.current(currentData);
        }
    }, []); // Stable handleSync

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
                    const obj = instance.jspreadsheet || instance;
                    const idx = parseInt(String(rowIndex), 10);
                    const count = parseInt(String(numOfRows), 10);
                    if (!isNaN(idx) && !isNaN(count)) {
                        hfRef.current?.batch(() => {
                            hfRef.current?.addRows(sheetIdRef.current, [idx, count]);
                        });
                    }
                    if (onRowChangeRef.current) onRowChangeRef.current('insert', idx, count);
                    if (onChangeRef.current) {
                        const currentData = obj.getData();
                        lastDataRef.current = currentData;
                        onChangeRef.current(currentData);
                    }
                },
                ondeleterow: (instance: any, rowIndex: number | string, numOfRows: number | string) => {
                    const obj = instance.jspreadsheet || instance;
                    const idx = parseInt(String(rowIndex), 10);
                    const count = parseInt(String(numOfRows), 10);
                    if (!isNaN(idx) && !isNaN(count)) {
                        hfRef.current?.batch(() => {
                            hfRef.current?.removeRows(sheetIdRef.current, [idx, count]);
                        });
                    }
                    if (onRowChangeRef.current) onRowChangeRef.current('delete', idx, count);
                    if (onChangeRef.current) {
                        const currentData = obj.getData();
                        lastDataRef.current = currentData;
                        onChangeRef.current(currentData);
                    }
                },
                oninsertcolumn: (instance: any, colIndex: number | string, numOfColumns: number | string) => {
                    const obj = instance.jspreadsheet || instance;
                    const idx = parseInt(String(colIndex), 10);
                    const count = parseInt(String(numOfColumns), 10);
                    if (!isNaN(idx) && !isNaN(count)) {
                        hfRef.current?.batch(() => {
                            hfRef.current?.addColumns(sheetIdRef.current, [idx, count]);
                        });
                    }
                    if (onColChangeRef.current) onColChangeRef.current('insert', idx, count);
                    if (onChangeRef.current) {
                        const currentData = obj.getData();
                        lastDataRef.current = currentData;
                        onChangeRef.current(currentData);
                    }
                },
                ondeletecolumn: (instance: any, colIndex: number | string, numOfColumns: number | string) => {
                    const obj = instance.jspreadsheet || instance;
                    const idx = parseInt(String(colIndex), 10);
                    const count = parseInt(String(numOfColumns), 10);
                    if (!isNaN(idx) && !isNaN(count)) {
                        hfRef.current?.batch(() => {
                            hfRef.current?.removeColumns(sheetIdRef.current, [idx, count]);
                        });
                    }
                    if (onColChangeRef.current) onColChangeRef.current('delete', idx, count);
                    if (onChangeRef.current) {
                        const currentData = obj.getData();
                        lastDataRef.current = currentData;
                        onChangeRef.current(currentData);
                    }
                },
            };

            options.columns = Array.isArray(columns) && columns.length > 0 ? columns : [];
            if (options.columns.length === 0 && data[0]?.length > 0) {
              // Ensure we have at least one column definition to avoid null issues in JSS internal code
              options.columns = Array.from({ length: data[0].length }, () => ({}));
            }

            const el = jss(spreadsheetRef.current, options);
            if (!el) {
                console.error('[Spreadsheet] Failed to initialize jspreadsheet instance');
                return;
            }

            // Sync HF
            if (hfRef.current && Array.isArray(data)) {
                // HyperFormula setCellContents for multiple cells usually requires setSheetContent or similar
                // but since we are just initializing, we can set the whole content if we loop
                // or if we use setSheetContent.
                try {
                    hfRef.current.setSheetContent(sheetIdRef.current, data);
                } catch (e) {
                    console.error('[Spreadsheet] HF sync error:', e);
                }
            }

            // Override engine
            const obj = el.jexcel || el;
            obj.executeFormula = (expression: string, x: number, y: number) => {
                if (expression && expression[0] === '=' && hfRef.current) {
                    try {
                        const result = hfRef.current.calculateFormula(expression, sheetIdRef.current);
                        if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) return result[0][0];
                        if (result === null || result === undefined) return '';
                        if (typeof result === 'object' && result.error) return result.message || '#ERROR!';
                        return String(result);
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

            // Track whether the user is actively interacting with this spreadsheet.
            // We use capture-phase listeners on the container so we know when focus
            // enters or leaves, even when jspreadsheet manages focus internally.
            const containerEl = spreadsheetRef.current;
            const handleFocusIn = () => { 
                isActiveRef.current = true; 
                notifySpreadsheetFocusIn();
            };
            const handleFocusOut = (e: FocusEvent) => {
                // Only deactivate if focus moves outside the container entirely
                if (containerEl && !containerEl.contains(e.relatedTarget as Node | null)) {
                    isActiveRef.current = false;
                    notifySpreadsheetFocusOut();
                }
            };
            const handleMouseDown = () => { 
                if (!isActiveRef.current) {
                    isActiveRef.current = true;
                    notifySpreadsheetFocusIn();
                }
            };
            if (containerEl) {
                containerEl.addEventListener('focusin', handleFocusIn, true);
                containerEl.addEventListener('focusout', handleFocusOut, true);
                containerEl.addEventListener('mousedown', handleMouseDown, true);
                (containerEl as any)._handleFocusIn = handleFocusIn;
                (containerEl as any)._handleFocusOut = handleFocusOut;
                (containerEl as any)._handleMouseDown = handleMouseDown;
            }

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
                    if (elDom && (elDom as any)._handleFocusIn) {
                        elDom.removeEventListener('focusin', (elDom as any)._handleFocusIn, true);
                        elDom.removeEventListener('focusout', (elDom as any)._handleFocusOut, true);
                        elDom.removeEventListener('mousedown', (elDom as any)._handleMouseDown, true);
                    }
                    if (isActiveRef.current) {
                        notifySpreadsheetFocusOut();
                    }
                    jRef.current.destroy();
                } catch (e) {
                    // Ignore destruction errors
                }
                jRef.current = null;
            }
        };
    }, [columns, minDimensions, readOnly, handleSync]);

    // Custom data comparison to avoid unnecessary updates (treats null as empty string)
    const isDataEqual = useCallback((a: any[][] | null, b: any[][] | null) => {
        if (!a || !b) return a === b;
        if (a.length !== b.length) return false;
        for (let r = 0; r < a.length; r++) {
            if (a[r].length !== b[r].length) return false;
            for (let c = 0; c < a[r].length; c++) {
                const valA = String(a[r][c] ?? '');
                const valB = String(b[r][c] ?? '');
                if (valA !== valB) return false;
            }
        }
        return true;
    }, []);

    // Update data without re-mounting
    useEffect(() => {
        if (!jRef.current) return;
        const obj = jRef.current.jspreadsheet || jRef.current;
        
        // Skip update if data matches last data received from or sent to Jspreadsheet
        if (isDataEqual(lastDataRef.current, data)) {
            return;
        }

        obj.ignoreEvents = true;

        // Capture current selection to restore it after data update
        const selected = obj.selectedCell;
        // Use isActiveRef: true if the user has interacted with this spreadsheet.
        // This is more reliable than checking document.activeElement because setData
        // may tear down/rebuild DOM elements, momentarily moving focus to <body>.
        const wasActive = isActiveRef.current;

        obj.setData(data);
        if (hfRef.current) {
            try {
                hfRef.current.setSheetContent(sheetIdRef.current, data);
            } catch (e) {
                console.error('[Spreadsheet] HF update error:', e);
            }
        }

        // Restore selection if it existed
        if (selected) {
            try {
                obj.updateSelectionFromCoords(selected[0], selected[1], selected[2], selected[3]);
                // Refocus the hidden textarea so keyboard events stay within jspreadsheet
                // and are not picked up by the tree's global keydown handler.
                if (wasActive) {
                    const textarea = obj.el?.querySelector('textarea');
                    if (textarea) textarea.focus();
                }
            } catch (e) {
                // Ignore if selection restoration fails
            }
        }

        obj.ignoreEvents = false;
        lastDataRef.current = data;
    }, [data, isDataEqual]);

    return (
        <div className={className} data-jspreadsheet-container="true">
            <div ref={spreadsheetRef} />
        </div>
    );
}
