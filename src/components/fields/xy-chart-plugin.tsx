"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from "react-dom";
import { FieldTypePlugin } from '@/lib/field-types/registry';
import { LineChart as LineChartIcon } from 'lucide-react';
import { Field, XYChartData } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Label as ChartLabel, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { DataSheetGrid, textColumn, keyColumn, createContextMenuComponent, ContextMenuComponentProps } from 'react-datasheet-grid';
import 'react-datasheet-grid/dist/style.css';

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
    points,
    onChange,
}: {
    points: { x: string; y: string }[];
    onChange: (newPoints: { x: string; y: string }[]) => void;
}) => {
    const columns = useMemo(() => [
        {
            ...keyColumn('x', textColumn),
            title: 'X',
        },
        {
            ...keyColumn('y', textColumn),
            title: 'Y',
        },
    ], []);

    const gridData = useMemo(() => {
        return points.length > 0 ? points : [{ x: '', y: '' }];
    }, [points]);

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
                    value={gridData}
                    onChange={(newValue) => {
                        onChange(newValue as { x: string; y: string }[]);
                    }}
                    columns={columns}
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
    const chartData: XYChartData = { points: [], ...value };

    const handleChartDataChange = (index: number, key: 'x' | 'y' | 'xAxisLabel' | 'yAxisLabel' | 'showAverage' | 'showStdDev' | 'showRelativeError' | 'showLinearRegression', newValue: string | boolean) => {
        if (key === 'xAxisLabel' || key === 'yAxisLabel' || key === 'showAverage' || key === 'showStdDev' || key === 'showRelativeError' || key === 'showLinearRegression') {
            onChange({ ...chartData, [key]: newValue });
            return;
        }
        const newPoints = [...(chartData.points || [])];
        if (newPoints[index]) {
            newPoints[index] = { ...newPoints[index], [key]: newValue };
        }
        onChange({ ...chartData, points: newPoints });
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"> 
                    <Label htmlFor={`${field.id}-x-label`} className="text-xs">X-Axis Label</Label> 
                    <Input id={`${field.id}-x-label`} placeholder="e.g., Time (s)" value={chartData.xAxisLabel || ''} onChange={e => handleChartDataChange(0, 'xAxisLabel', e.target.value)} />
                </div>
                <div className="space-y-2"> 
                    <Label htmlFor={`${field.id}-y-label`} className="text-xs">Y-Axis Label</Label> 
                    <Input id={`${field.id}-y-label`} placeholder="e.g., Temperature (°C)" value={chartData.yAxisLabel || ''} onChange={e => handleChartDataChange(0, 'yAxisLabel', e.target.value)} />
                </div>
            </div>

            <div className="flex flex-wrap gap-4 items-center p-2 border rounded-md bg-muted/30">
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id={`${field.id}-show-avg`}
                        checked={!!chartData.showAverage}
                        onCheckedChange={(checked) => handleChartDataChange(0, 'showAverage', !!checked)}
                    />
                    <Label htmlFor={`${field.id}-show-avg`} className="text-xs cursor-pointer">Show Average</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id={`${field.id}-show-std`}
                        checked={!!chartData.showStdDev}
                        onCheckedChange={(checked) => handleChartDataChange(0, 'showStdDev', !!checked)}
                    />
                    <Label htmlFor={`${field.id}-show-std`} className="text-xs cursor-pointer">Show Std Dev</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id={`${field.id}-show-rel`}
                        checked={!!chartData.showRelativeError}
                        onCheckedChange={(checked) => handleChartDataChange(0, 'showRelativeError', !!checked)}
                    />
                    <Label htmlFor={`${field.id}-show-rel`} className="text-xs cursor-pointer">Show Relative Error</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id={`${field.id}-show-reg`}
                        checked={!!chartData.showLinearRegression}
                        onCheckedChange={(checked) => handleChartDataChange(0, 'showLinearRegression', !!checked)}
                    />
                    <Label htmlFor={`${field.id}-show-reg`} className="text-xs cursor-pointer">Show Linear Regression</Label>
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs">Data Points (X, Y)</Label>
                <p className="text-xs text-muted-foreground mb-2">Manage your data in the grid below.</p>
                <XYChartSpreadsheetEditor
                    points={chartData.points}
                    onChange={(newPoints) => {
                        onChange({
                            ...chartData,
                            points: newPoints
                        });
                    }}
                />
            </div>
        </div>
    );
});
XYChartEditorComponent.displayName = "XYChartEditorComponent";

const XYChartViewerComponent = ({ field, value, node, isCompactView }: any) => {
    const chartData: XYChartData = value;
    if (!chartData) return null;
    const rawPoints = chartData.points || [];
    const originalNumericData = rawPoints.map((d: any) => ({ ...d, x: Number(d.x), y: Number(d.y) })).filter((d: any) => !isNaN(d.x) && !isNaN(d.y));

    if (chartData.showLinearRegression && rawPoints.length > 0 && originalNumericData.length < rawPoints.length) {
        console.warn(`[XY-Chart] Field "${field.name}" (node "${node.name}"): ${rawPoints.length - originalNumericData.length} point(s) filtered out because they were non-numeric.`);
    }

    if (originalNumericData.length === 0) return null;

    const yValues = originalNumericData.map((p: any) => p.y);
    const xValues = originalNumericData.map((p: any) => p.x);
    const n = yValues.length;
    const mean = n > 0 ? yValues.reduce((a: number, b: number) => a + b, 0) / n : 0;
    const variance = n > 0 ? yValues.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / n : 0;
    const stdDev = Math.sqrt(variance);
    const relError = Math.abs(mean) > 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

    let regressionStats = null;
    let m: number | null = null;
    let b: number | null = null;

    if (chartData.showLinearRegression) {
        if (n > 1) {
            const sumX = xValues.reduce((a: number, b: number) => a + b, 0);
            const sumY = yValues.reduce((a: number, b: number) => a + b, 0);
            const sumXY = originalNumericData.reduce((prev: number, curr: any) => prev + (curr.x * curr.y), 0);
            const sumX2 = xValues.reduce((prev: number, curr: number) => prev + (curr * curr), 0);
            const denominator = (n * sumX2 - sumX * sumX);

            if (denominator !== 0) {
                m = (n * sumXY - sumX * sumY) / denominator;
                b = (sumY - m * sumX) / n;

                const ssRes = originalNumericData.reduce((acc: number, curr: any) => acc + Math.pow(curr.y - (m! * curr.x + b!), 2), 0);
                const ssTot = yValues.reduce((acc: number, curr: number) => acc + Math.pow(curr - mean, 2), 0);
                const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 1;

                regressionStats = {
                    equation: `y = ${m.toFixed(2)}x ${b >= 0 ? '+' : '-'} ${Math.abs(b).toFixed(2)}`,
                    rSquared: rSquared.toFixed(3)
                };
            } else {
                console.warn(`[XY-Chart] Field "${field.name}" (node "${node.name}"): Cannot calculate linear regression because all X values are identical (denominator is zero).`);
            }
        } else {
            console.warn(`[XY-Chart] Field "${field.name}" (node "${node.name}"): Cannot calculate linear regression with fewer than 2 numeric points (found ${n} points).`);
        }
    }

    const chartDataWithRegression = originalNumericData.map((p: any) => ({
        ...p,
        regression: (m !== null && b !== null) ? (m * p.x + b) : undefined
    }));

    const formatTick = (tickVal: any) => {
        if (typeof tickVal !== 'number') return tickVal;
        return parseFloat(tickVal.toFixed(2)).toString();
    };

    return (
        <div key={field.id} className="mt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <p className={cn("font-medium mb-2", isCompactView ? "text-xs" : "text-sm")}>{field.name}</p>
            <div style={{ width: '100%', height: isCompactView ? 180 : 300 }}>
                <ResponsiveContainer>
                    <LineChart data={chartDataWithRegression} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={formatTick}>
                            <ChartLabel value={chartData.xAxisLabel} offset={-15} position="insideBottom" />
                        </XAxis>
                        <YAxis domain={['auto', 'auto']} interval={0} tickFormatter={formatTick}>
                            <ChartLabel value={chartData.yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
                        </YAxis>
                        <ChartTooltip formatter={(val: any) => formatTick(val)} />
                        <Line type="monotone" dataKey="y" stroke="hsl(var(--primary))" dot={{ r: 2 }} isAnimationActive={false} />

                        {chartData.showLinearRegression && m !== null && (
                            <Line
                                type="monotone"
                                dataKey="regression"
                                stroke="hsl(var(--primary))"
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={false}
                                activeDot={false}
                                isAnimationActive={false}
                                label={((props: any) => {
                                    const { x, y, index } = props;
                                    if (index === chartDataWithRegression.length - 1 && regressionStats) {
                                        return (
                                            <text x={x} y={y} dy={-10} fill="hsl(var(--primary))" fontSize={10} textAnchor="end">
                                                {`${regressionStats.equation}, R² = ${regressionStats.rSquared}`}
                                            </text>
                                        );
                                    }
                                    return null;
                                }) as any}
                            />
                        )}

                        {chartData.showAverage && n > 0 && (
                            <ReferenceLine
                                y={mean}
                                stroke="hsl(var(--destructive))"
                                strokeDasharray="3 3"
                                label={{
                                    value: `Avg: ${mean.toFixed(2)}`,
                                    position: 'insideLeft',
                                    fill: 'hsl(var(--destructive))',
                                    fontSize: 10
                                }}
                            />
                        )}
                        {chartData.showStdDev && n > 0 && (
                            <ReferenceArea
                                y1={mean - stdDev}
                                y2={mean + stdDev}
                                fill="hsl(var(--destructive))"
                                fillOpacity={0.1}
                                strokeOpacity={0}
                            />
                        )}
                        {chartData.showRelativeError && relError > 0 && (
                            <ChartLabel
                                value={`Rel Error: ${relError.toFixed(2)}%`}
                                position="insideTopRight"
                                offset={10}
                                fill="hsl(var(--muted-foreground))"
                                fontSize={10}
                            />
                        )}
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
    sanitizeOnSave: (value: any) => {
        if (!value) return value;
        const chartData = value as XYChartData;
        if (!Array.isArray(chartData.points)) return value;
        return {
            ...chartData,
            points: chartData.points.filter(row =>
                (row.x?.toString().trim() ?? '') !== '' ||
                (row.y?.toString().trim() ?? '') !== ''
            ),
        };
    },
};
