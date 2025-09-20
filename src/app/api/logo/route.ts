/**
 * @fileoverview
 * This API route serves the custom logo file.
 * It reads the `logo.svg` from the private `data/custom` directory
 * and returns it as an SVG image response, making it accessible to the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: NextRequest) {
    try {
        const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || 'data');
        const logoPath = path.join(dataDir, 'custom', 'logo.svg');

        const fileBuffer = await fs.readFile(logoPath);

        const headers = new Headers();
        headers.set('Content-Type', 'image/svg+xml');
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');

        return new NextResponse(fileBuffer, {
            status: 200,
            headers,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // If the custom logo doesn't exist, it's not an error,
            // the client will fall back to the default.
            return new NextResponse('Logo not found', { status: 404 });
        }
        console.error('Failed to serve logo:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

// Add a dummy POST to satisfy some deployment platforms
export async function POST(request: NextRequest) {
    return new NextResponse('Method Not Allowed', { status: 405 });
}
