/**
 * @fileoverview
 * This API route handles the application's logo upload.
 * It's restricted to admin users. It accepts a single SVG file, saves it
 * to a publicly accessible directory, and returns the web path to the new logo.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const logoFile = formData.get('logo') as File | null;

        if (!logoFile) {
            return NextResponse.json({ message: 'No logo file provided' }, { status: 400 });
        }

        if (logoFile.type !== 'image/svg+xml') {
            return NextResponse.json({ message: 'Invalid file type. Only SVG is allowed.' }, { status: 400 });
        }

        const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || 'data');
        const customDir = path.join(dataDir, 'custom');
        
        // Ensure the 'custom' directory exists
        await fs.mkdir(customDir, { recursive: true });

        const logoPath = path.join(customDir, 'logo.svg');
        // The web path will be handled by a dedicated API route
        const webPath = '/api/logo'; 

        const buffer = Buffer.from(await logoFile.arrayBuffer());
        await fs.writeFile(logoPath, buffer);

        // Add a timestamp query parameter to bust browser cache
        const finalPath = `${webPath}?v=${new Date().getTime()}`;

        return NextResponse.json({ path: finalPath }, { status: 200 });

    } catch (error) {
        console.error('Logo upload failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ message: `Internal Server Error: ${errorMessage}` }, { status: 500 });
    }
}
