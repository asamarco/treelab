"use client";

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from "react-dom";
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { LineChart as LineChartIcon, Plus, Trash2 } from 'lucide-react';
import { Field, XYChartData, XYChartColumn } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Label as ChartLabel, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Legend } from 'recharts';
import { DataSheetGrid, textColumn, keyColumn, createContextMenuComponent, ContextMenuComponentProps, DataSheetGridRef } from 'react-datasheet-grid';
import 'react-datasheet-grid/dist/style.css';

const DEFAULT_PALETTE = [
    '#2FBF9A', // treelab green
    '#EF4444', // red
    '#1496C9', // cyan
    '#FF5A3C', // orange
    '#A56CFF', // purple
    '#F0C33A', // yellow
    '#0B63D9', // blue
    '#ec4899', // pink
];

export function normalizeXYChartData(value: any): XYChartData {
    if (!value || typeof value !== 'object') {
        return {
            columns: [
                { id: 'x', name: 'X', role: 'x' },
                { id: 'y', name: 'Y', role: 'y1' },
            ],
            rows: [],
        };
    }

    if (Array.isArray(value.columns)) {
        const cols: XYChartColumn[] = value.columns.map((c: any, idx: number) => ({
            id: c.id || (idx === 0 ? 'x' : `y_${idx}`),
            name: c.name || (idx === 0 ? 'X' : `Y${idx}`),
            role: c.role || (idx === 0 ? 'x' : 'y1'),
            color: c.color,
            showAverage: !!c.showAverage,
            showStdDev: !!c.showStdDev,
            showRelativeError: !!c.showRelativeError,
            showLinearRegression: !!c.showLinearRegression,
        }));

        if (!cols.some(c => c.role === 'x')) {
            if (cols.length > 0) {
                cols[0].role = 'x';
            } else {
                cols.push({ id: 'x', name: 'X', role: 'x' });
            }
        }

        if (!cols.some(c => c.role === 'y1' || c.role === 'y2')) {
            cols.push({ id: 'y', name: 'Y', role: 'y1' });
        }

        return {
            columns: cols,
            rows: Array.isArray(value.rows) ? value.rows : [],
            xAxisLabel: value.xAxisLabel,
            y1AxisLabel: value.y1AxisLabel ?? value.yAxisLabel,
            y2AxisLabel: value.y2AxisLabel,
        };
    }

    if (Array.isArray(value.points)) {
        return {
            columns: [
                { id: 'x', name: 'X', role: 'x' },
                {
                    id: 'y',
                    name: 'Y',
                    role: 'y1',
                    showAverage: !!value.showAverage,
                    showStdDev: !!value.showStdDev,
                    showRelativeError: !!value.showRelativeError,
                    showLinearRegression: !!value.showLinearRegression,
                },
            ],
            rows: value.points.map((p: any) => ({
                x: p?.x !== undefined && p?.x !== null ? String(p.x) : '',
                y: p?.y !== undefined && p?.y !== null ? String(p.y) : '',
            })),
            xAxisLabel: value.xAxisLabel,
            y1AxisLabel: value.yAxisLabel,
            y2AxisLabel: undefined,
        };
    }

    return {
        columns: [
            { id: 'x', name: 'X', role: 'x' },
            { id: 'y', name: 'Y', role: 'y1' },
        ],
        rows: [],
    };
}

const PortaledContextMenu = (props: ContextMenuComponentProps) => {
    const ContextMenu = useMemo(() => createContextMenuComponent(), []);

    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    return createPortal(
        <div className="ds-grid-container fixed inset-0 pointer-events-none z-[99999]">
            <ContextMenu {...props} />
        </div>,
        document.body
    );
};

const XYChartSpreadsheetEditor = React.memo(({
    columns,
    rows,
    onChange,
}: {
    columns: XYChartColumn[];
    rows: Record<string, string>[];
    onChange: (newRows: Record<string, string>[]) => void;
}) => {
    const gridRef = useRef<DataSheetGridRef>(null);

    const dataSheetColumns = useMemo(() => {
        return columns.map(col => ({
            ...keyColumn(col.id, textColumn),
            title: col.name,
        }));
    }, [columns]);

    const gridData = useMemo(() => {
        if (rows.length > 0) return rows;
        const emptyRow: Record<string, string> = {};
        columns.forEach(col => { emptyRow[col.id] = ''; });
        return [emptyRow];
    }, [rows, columns]);

    return (
        <div className="space-y-2" onKeyDown={(e) => {
            const isNavigationKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p', 's', 'o'].includes(e.key);
            if (isNavigationKey) {
                e.stopPropagation();
            }
        }}>
            <div
                className="rounded-md border w-full bg-background overflow-x-auto ds-grid-container"
                onContextMenuCapture={(e) => {
                    e.preventDefault();
                }}
                onKeyDownCapture={(e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        e.stopPropagation();

                        const currentActive = gridRef.current?.activeCell;
                        const col = currentActive?.col ?? 0;
                        const row = currentActive?.row ?? 0;
                        const colCount = columns.length;

                        if (e.shiftKey) {
                            let prevCol = col - 1;
                            let prevRow = row;
                            if (prevCol < 0) {
                                prevCol = colCount - 1;
                                prevRow = row - 1;
                            }
                            if (prevRow < 0) {
                                prevRow = 0;
                                prevCol = 0;
                            }
                            gridRef.current?.setActiveCell({ col: prevCol, row: prevRow });
                        } else {
                            let nextCol = col + 1;
                            let nextRow = row;
                            if (nextCol >= colCount) {
                                nextCol = 0;
                                nextRow = row + 1;
                            }
                            if (nextRow >= gridData.length) {
                                const newEmptyRow: Record<string, string> = {};
                                columns.forEach(c => { newEmptyRow[c.id] = ''; });
                                const newRows = [...gridData, newEmptyRow];
                                onChange(newRows);
                                setTimeout(() => {
                                    gridRef.current?.setActiveCell({ col: 0, row: nextRow });
                                }, 0);
                            } else {
                                gridRef.current?.setActiveCell({ col: nextCol, row: nextRow });
                            }
                        }
                    }
                }}
                onKeyDown={(e) => {
                    const isCtrl = e.ctrlKey || e.metaKey;
                    if (
                        e.key === 'Delete' ||
                        e.key === 'Backspace' ||
                        (isCtrl && (e.key === 'c' || e.key === 'x' || e.key === 'v' || e.key === 'a' || e.key === 'z' || e.key === 'y'))
                    ) {
                        e.stopPropagation();
                    }
                }}
            >
                <DataSheetGrid
                    key={columns.map(c => c.id).join(',')}
                    ref={gridRef}
                    value={gridData}
                    onChange={(newValue) => {
                        onChange(newValue as Record<string, string>[]);
                    }}
                    columns={dataSheetColumns}
                    autoAddRow
                    lockRows={false}
                    contextMenuComponent={PortaledContextMenu}
                />
            </div>
            <p className="text-[10px] text-muted-foreground italic">
                Tip: You can copy and paste data directly from Excel or other spreadsheets.
            </p>
        </div>
    );
});
XYChartSpreadsheetEditor.displayName = "XYChartSpreadsheetEditor";

const XYChartEditorComponent = React.memo(({ field, value, onChange }: { field: Field, value: any, onChange: (value: any) => void }) => {
    const chartData = useMemo(() => normalizeXYChartData(value), [value]);

    const yColumns = useMemo(() => {
        return chartData.columns.filter(c => c.role === 'y1' || c.role === 'y2');
    }, [chartData.columns]);

    const handleAxisLabelChange = (key: 'xAxisLabel' | 'y1AxisLabel' | 'y2AxisLabel', val: string) => {
        onChange({ ...chartData, [key]: val });
    };

    const handleUpdateColumn = (columnId: string, updates: Partial<XYChartColumn>) => {
        const updatedColumns = chartData.columns.map(c => {
            if (c.id === columnId) {
                return { ...c, ...updates };
            }
            return c;
        });
        onChange({ ...chartData, columns: updatedColumns });
    };

    const handleAddSeries = () => {
        const newId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `col_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const yCount = yColumns.length;
        const newColumn: XYChartColumn = {
            id: newId,
            name: `Series ${yCount + 1}`,
            role: 'y1',
            color: DEFAULT_PALETTE[yCount % DEFAULT_PALETTE.length],
        };

        const updatedColumns = [...chartData.columns, newColumn];
        const updatedRows = chartData.rows.map(row => ({
            ...row,
            [newId]: '',
        }));

        onChange({
            ...chartData,
            columns: updatedColumns,
            rows: updatedRows,
        });
    };

    const handleRemoveColumn = (columnId: string) => {
        if (yColumns.length <= 1) return; // Prevent removing the last Y column

        const updatedColumns = chartData.columns.filter(c => c.id !== columnId);
        const updatedRows = chartData.rows.map(row => {
            const newRow = { ...row };
            delete newRow[columnId];
            return newRow;
        });

        onChange({
            ...chartData,
            columns: updatedColumns,
            rows: updatedRows,
        });
    };

    const hasY2Series = yColumns.some(c => c.role === 'y2');

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                    <Label htmlFor={`${field.id}-x-label`} className="text-xs">X-Axis Label</Label>
                    <Input id={`${field.id}-x-label`} placeholder="e.g., Time (s)" value={chartData.xAxisLabel || ''} onChange={e => handleAxisLabelChange('xAxisLabel', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`${field.id}-y1-label`} className="text-xs">Y1-Axis Label (Primary)</Label>
                    <Input id={`${field.id}-y1-label`} placeholder="e.g., Temperature (°C)" value={chartData.y1AxisLabel || ''} onChange={e => handleAxisLabelChange('y1AxisLabel', e.target.value)} />
                </div>
                <div className={cn("space-y-2", !hasY2Series && "opacity-60")}>
                    <Label htmlFor={`${field.id}-y2-label`} className="text-xs">Y2-Axis Label (Secondary)</Label>
                    <Input id={`${field.id}-y2-label`} placeholder="e.g., Pressure (kPa)" value={chartData.y2AxisLabel || ''} onChange={e => handleAxisLabelChange('y2AxisLabel', e.target.value)} />
                </div>
            </div>

            <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Series Configuration</Label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddSeries} className="h-7 text-xs flex items-center gap-1">
                        <Plus className="h-3.5 w-3.5" />
                        Add Series
                    </Button>
                </div>

                <div className="space-y-3">
                    {yColumns.map((col, idx) => {
                        const colColor = col.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
                        return (
                            <div key={col.id} className="p-2.5 border rounded bg-background space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex-1 min-w-[140px]">
                                        <Input
                                            value={col.name}
                                            onChange={e => handleUpdateColumn(col.id, { name: e.target.value })}
                                            className="h-8 text-xs font-medium"
                                            placeholder="Series Name"
                                        />
                                    </div>
                                    <div className="w-28">
                                        <Select
                                            value={col.role}
                                            onValueChange={(val: 'y1' | 'y2') => handleUpdateColumn(col.id, { role: val })}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="y1">Y1 (Primary)</SelectItem>
                                                <SelectItem value="y2">Y2 (Secondary)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="color"
                                            value={colColor}
                                            onChange={e => handleUpdateColumn(col.id, { color: e.target.value })}
                                            className="w-7 h-7 p-0.5 rounded cursor-pointer border bg-transparent"
                                            title="Choose line color"
                                        />
                                        <div className="flex gap-1">
                                            {DEFAULT_PALETTE.slice(0, 5).map(c => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    className="w-4 h-4 rounded-full border border-black/10 transition-transform hover:scale-110"
                                                    style={{ backgroundColor: c }}
                                                    onClick={() => handleUpdateColumn(col.id, { color: c })}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        disabled={yColumns.length <= 1}
                                        onClick={() => handleRemoveColumn(col.id)}
                                        title={yColumns.length <= 1 ? "At least one Y series required" : "Remove series"}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="flex flex-wrap gap-3 items-center pt-1 border-t text-xs text-muted-foreground">
                                    <div className="flex items-center space-x-1.5">
                                        <Checkbox
                                            id={`${field.id}-${col.id}-avg`}
                                            checked={!!col.showAverage}
                                            onCheckedChange={checked => handleUpdateColumn(col.id, { showAverage: !!checked })}
                                        />
                                        <Label htmlFor={`${field.id}-${col.id}-avg`} className="text-xs cursor-pointer">Average</Label>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                        <Checkbox
                                            id={`${field.id}-${col.id}-std`}
                                            checked={!!col.showStdDev}
                                            onCheckedChange={checked => handleUpdateColumn(col.id, { showStdDev: !!checked })}
                                        />
                                        <Label htmlFor={`${field.id}-${col.id}-std`} className="text-xs cursor-pointer">Std Dev</Label>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                        <Checkbox
                                            id={`${field.id}-${col.id}-rel`}
                                            checked={!!col.showRelativeError}
                                            onCheckedChange={checked => handleUpdateColumn(col.id, { showRelativeError: !!checked })}
                                        />
                                        <Label htmlFor={`${field.id}-${col.id}-rel`} className="text-xs cursor-pointer">Rel Error</Label>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                        <Checkbox
                                            id={`${field.id}-${col.id}-reg`}
                                            checked={!!col.showLinearRegression}
                                            onCheckedChange={checked => handleUpdateColumn(col.id, { showLinearRegression: !!checked })}
                                        />
                                        <Label htmlFor={`${field.id}-${col.id}-reg`} className="text-xs cursor-pointer">Linear Reg</Label>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs">Data Points</Label>
                <p className="text-xs text-muted-foreground mb-2">Manage your data in the grid below.</p>
                <XYChartSpreadsheetEditor
                    columns={chartData.columns}
                    rows={chartData.rows}
                    onChange={(newRows) => {
                        onChange({
                            ...chartData,
                            rows: newRows,
                        });
                    }}
                />
            </div>
        </div>
    );
});
XYChartEditorComponent.displayName = "XYChartEditorComponent";

function getNiceDomain(min: number, max: number): [number, number] {
    if (min === max) {
        if (min === 0) return [0, 1];
        const step = Math.pow(10, Math.floor(Math.log10(Math.abs(min))));
        return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
    }

    const span = max - min;
    const order = Math.pow(10, Math.floor(Math.log10(span)));

    let step = order;
    if (span / order < 2) {
        step = order / 5;
    } else if (span / order < 5) {
        step = order / 2;
    }

    let niceMin = Math.floor(min / step) * step;
    let niceMax = Math.ceil(max / step) * step;

    const precision = Math.max(0, -Math.floor(Math.log10(step)) + 2);
    niceMin = parseFloat(niceMin.toFixed(precision));
    niceMax = parseFloat(niceMax.toFixed(precision));

    return [niceMin, niceMax];
}

interface SeriesStats {
    col: XYChartColumn;
    color: string;
    mean: number;
    variance: number;
    stdDev: number;
    relError: number;
    regressionStats: { equation: string; rSquared: string } | null;
    m: number | null;
    b: number | null;
    validCount: number;
}

const XYChartViewerComponent = ({ field, value, node, isCompactView }: any) => {
    const chartData = useMemo(() => (value ? normalizeXYChartData(value) : null), [value]);

    if (!chartData || !chartData.rows || chartData.rows.length === 0) return null;

    const xCol = chartData.columns.find(c => c.role === 'x') || chartData.columns[0];
    const yCols = chartData.columns.filter(c => c.role === 'y1' || c.role === 'y2');

    if (!xCol || yCols.length === 0) return null;

    const hasY2 = yCols.some(c => c.role === 'y2');

    // Build chart rows where X is numeric
    const chartRows: Record<string, any>[] = [];
    chartData.rows.forEach(row => {
        const xRaw = row[xCol.id];
        const xNum = Number(xRaw);
        if (xRaw === '' || xRaw === undefined || xRaw === null || isNaN(xNum)) {
            return;
        }
        const rowObj: Record<string, any> = { x: xNum };
        yCols.forEach(col => {
            const yRaw = row[col.id];
            const yNum = Number(yRaw);
            if (yRaw !== '' && yRaw !== undefined && yRaw !== null && !isNaN(yNum)) {
                rowObj[col.id] = yNum;
            } else {
                rowObj[col.id] = undefined;
            }
        });
        chartRows.push(rowObj);
    });

    if (chartRows.length === 0) return null;

    const xValues = chartRows.map(r => r.x as number);
    const xMin = xValues.length > 0 ? Math.min(...xValues) : undefined;
    const xMax = xValues.length > 0 ? Math.max(...xValues) : undefined;
    const xDomain = (typeof xMin === 'number' && typeof xMax === 'number' && !isNaN(xMin) && !isNaN(xMax))
        ? getNiceDomain(xMin, xMax)
        : ['dataMin', 'dataMax'];

    // Calculate per-column stats
    const seriesStatsList: SeriesStats[] = yCols.map((col, colIdx) => {
        const color = col.color || DEFAULT_PALETTE[colIdx % DEFAULT_PALETTE.length];
        const colPoints = chartRows
            .filter(r => r[col.id] !== undefined)
            .map(r => ({ x: r.x as number, y: r[col.id] as number }));

        const n = colPoints.length;

        // Check for non-numeric warnings
        if (col.showLinearRegression || col.showAverage || col.showStdDev || col.showRelativeError) {
            let nonNumericCount = 0;
            chartData.rows.forEach(row => {
                const xVal = Number(row[xCol.id]);
                if (!isNaN(xVal)) {
                    const yRaw = row[col.id];
                    if (yRaw !== '' && yRaw !== undefined && yRaw !== null && isNaN(Number(yRaw))) {
                        nonNumericCount++;
                    }
                }
            });
            if (nonNumericCount > 0) {
                console.warn(`[XY-Chart] Field "${field.name}" (node "${node.name}"), series "${col.name}": ${nonNumericCount} point(s) filtered out because they were non-numeric.`);
            }
        }

        const yValues = colPoints.map(p => p.y);
        const xValues = colPoints.map(p => p.x);
        const mean = n > 0 ? yValues.reduce((a, b) => a + b, 0) / n : 0;
        const variance = n > 0 ? yValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n : 0;
        const stdDev = Math.sqrt(variance);
        const relError = Math.abs(mean) > 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

        let regressionStats = null;
        let m: number | null = null;
        let b: number | null = null;

        if (col.showLinearRegression) {
            if (n > 1) {
                const sumX = xValues.reduce((a, b) => a + b, 0);
                const sumY = yValues.reduce((a, b) => a + b, 0);
                const sumXY = colPoints.reduce((prev, curr) => prev + (curr.x * curr.y), 0);
                const sumX2 = xValues.reduce((prev, curr) => prev + (curr * curr), 0);
                const denominator = (n * sumX2 - sumX * sumX);

                if (denominator !== 0) {
                    m = (n * sumXY - sumX * sumY) / denominator;
                    b = (sumY - m * sumX) / n;

                    const ssRes = colPoints.reduce((acc, curr) => acc + Math.pow(curr.y - (m! * curr.x + b!), 2), 0);
                    const ssTot = yValues.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0);
                    const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 1;

                    regressionStats = {
                        equation: `y = ${m.toFixed(2)}x ${b >= 0 ? '+' : '-'} ${Math.abs(b).toFixed(2)}`,
                        rSquared: rSquared.toFixed(3),
                    };
                } else {
                    console.warn(`[XY-Chart] Field "${field.name}" (node "${node.name}"), series "${col.name}": Cannot calculate linear regression because all X values are identical (denominator is zero).`);
                }
            } else {
                console.warn(`[XY-Chart] Field "${field.name}" (node "${node.name}"), series "${col.name}": Cannot calculate linear regression with fewer than 2 numeric points (found ${n} points).`);
            }
        }

        return {
            col,
            color,
            mean,
            variance,
            stdDev,
            relError,
            regressionStats,
            m,
            b,
            validCount: n,
        };
    });

    // Attach regression data keys to chart rows
    const chartDataWithRegression = chartRows.map(row => {
        const newRow = { ...row };
        seriesStatsList.forEach(stats => {
            if (stats.col.showLinearRegression && stats.m !== null && stats.b !== null) {
                newRow[`regression_${stats.col.id}`] = stats.m * row.x + stats.b;
            }
        });
        return newRow;
    });

    const formatTick = (tickVal: any) => {
        if (typeof tickVal !== 'number') return tickVal;
        return parseFloat(tickVal.toFixed(2)).toString();
    };

    return (
        <div key={field.id} className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <p className={cn("font-medium mb-2", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
            <div style={{ width: '100%', height: isCompactView ? 180 : 300 }}>
                <ResponsiveContainer>
                    <LineChart data={chartDataWithRegression} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" type="number" domain={xDomain as any} tickFormatter={formatTick}>
                            <ChartLabel value={chartData.xAxisLabel} offset={-15} position="insideBottom" />
                        </XAxis>
                        <YAxis yAxisId="y1" orientation="left" domain={['auto', 'auto']} interval={0} tickFormatter={formatTick}>
                            <ChartLabel value={chartData.y1AxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
                        </YAxis>
                        {hasY2 && (
                            <YAxis yAxisId="y2" orientation="right" domain={['auto', 'auto']} interval={0} tickFormatter={formatTick}>
                                <ChartLabel value={chartData.y2AxisLabel} angle={90} position="insideRight" style={{ textAnchor: 'middle' }} />
                            </YAxis>
                        )}
                        <ChartTooltip formatter={(val: any) => formatTick(val)} />
                        <Legend align="right" verticalAlign="bottom" wrapperStyle={{ paddingTop: '8px' }} />

                        {seriesStatsList.map((stats) => (
                            <Line
                                key={stats.col.id}
                                yAxisId={stats.col.role}
                                type="monotone"
                                dataKey={stats.col.id}
                                name={stats.col.name}
                                stroke={stats.color}
                                dot={{ r: 2 }}
                                isAnimationActive={false}
                            />
                        ))}

                        {seriesStatsList.map((stats, colIdx) => {
                            if (!stats.col.showLinearRegression || stats.m === null || !stats.regressionStats) return null;
                            return (
                                <Line
                                    key={`reg-${stats.col.id}`}
                                    yAxisId={stats.col.role}
                                    type="monotone"
                                    dataKey={`regression_${stats.col.id}`}
                                    name={`${stats.col.name} (Reg)`}
                                    stroke={stats.color}
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    dot={false}
                                    activeDot={false}
                                    isAnimationActive={false}
                                    label={((props: any) => {
                                        const { x, y, index } = props;
                                        if (index === chartDataWithRegression.length - 1 && stats.regressionStats) {
                                            return (
                                                <text
                                                    x={x}
                                                    y={y}
                                                    dy={-10 - colIdx * 12}
                                                    fill={stats.color}
                                                    fontSize={10}
                                                    textAnchor="end"
                                                >
                                                    {`${stats.col.name}: ${stats.regressionStats.equation}, R² = ${stats.regressionStats.rSquared}`}
                                                </text>
                                            );
                                        }
                                        return null;
                                    }) as any}
                                />
                            );
                        })}

                        {seriesStatsList.map((stats) => {
                            if (!stats.col.showAverage || stats.validCount === 0) return null;
                            return (
                                <ReferenceLine
                                    key={`avg-${stats.col.id}`}
                                    yAxisId={stats.col.role}
                                    y={stats.mean}
                                    stroke={stats.color}
                                    strokeDasharray="3 3"
                                    label={{
                                        value: `${stats.col.name} Avg: ${stats.mean.toFixed(2)}`,
                                        position: 'insideLeft',
                                        fill: stats.color,
                                        fontSize: 10,
                                    }}
                                />
                            );
                        })}

                        {seriesStatsList.map((stats) => {
                            if (!stats.col.showStdDev || stats.validCount === 0) return null;
                            return (
                                <ReferenceArea
                                    key={`std-${stats.col.id}`}
                                    yAxisId={stats.col.role}
                                    y1={stats.mean - stats.stdDev}
                                    y2={stats.mean + stats.stdDev}
                                    fill={stats.color}
                                    fillOpacity={0.1}
                                    strokeOpacity={0}
                                />
                            );
                        })}

                        {seriesStatsList.map((stats, colIdx) => {
                            if (!stats.col.showRelativeError || stats.validCount === 0) return null;
                            return (
                                <text
                                    key={`rel-${stats.col.id}`}
                                    x="95%"
                                    y={20 + colIdx * 14}
                                    textAnchor="end"
                                    fill={stats.color}
                                    fontSize={10}
                                    fontWeight="500"
                                >
                                    {`${stats.col.name} Rel Err: ${stats.relError.toFixed(2)}%`}
                                </text>
                            );
                        })}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export const XYChartPlugin: FieldTypePlugin = {
    type: "xy-chart",
    label: "XY Chart",
    icon: LineChartIcon,
    EditorComponent: XYChartEditorComponent,
    ViewerComponent: XYChartViewerComponent,
    isEmpty: (value: any, field?: Field) => {
        const chartData = normalizeXYChartData(value);
        if (!chartData.rows || chartData.rows.length === 0) return true;
        const yCols = chartData.columns.filter(c => c.role === 'y1' || c.role === 'y2');
        if (yCols.length === 0) return true;
        const hasAnyValue = chartData.rows.some(row =>
            yCols.some(col => (row[col.id]?.toString().trim() ?? '') !== '')
        );
        return !hasAnyValue;
    },
    sanitizeOnSave: (value: any) => {
        if (!value) return value;
        const chartData = normalizeXYChartData(value);
        const allCols = chartData.columns;
        const filteredRows = chartData.rows.filter(row =>
            allCols.some(col => (row[col.id]?.toString().trim() ?? '') !== '')
        );
        return {
            ...chartData,
            rows: filteredRows,
        };
    },
};
