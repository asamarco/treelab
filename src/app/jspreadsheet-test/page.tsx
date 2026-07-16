"use client";

import React, { useState } from 'react';
import { Spreadsheet } from '@/components/ui/spreadsheet';

export default function TestPage() {
    const [data, setData] = useState<any[][]>([
        ['10', '=A1*2'],
        ['20', '=A2*2'],
        ['=SUM(A1:A2)', '=SUM(B1:B2)'],
        ['', ''],
        ['=A1+B1', '=A3+B3'],
    ]);

    return (
        <div className="p-8 space-y-4 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold">Jspreadsheet + HyperFormula CSP Test</h1>
            <p className="text-muted-foreground">
                Testing the extracted generic Spreadsheet component with CSP-safe initialization and formula recalculation.
            </p>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
                <Spreadsheet 
                    data={data}
                    onChange={setData}
                    className="w-full"
                />
            </div>

            <div className="mt-8 p-4 bg-muted rounded-md border">
                <h2 className="font-semibold mb-2">Debug Data (Live Sync)</h2>
                <pre className="text-xs overflow-auto max-h-60 bg-background p-2 rounded border">
                    {JSON.stringify(data, null, 2)}
                </pre>
            </div>
        </div>
    );
}
