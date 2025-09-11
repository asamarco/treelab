
/**
 * @fileoverview
 * This API route handles all file uploads from the client (both pictures and attachments).
 * It receives form data containing the file as a data URI, saves it to the user's
 * private `attachments` directory, and returns the web-accessible path and metadata.
 * It now includes logic to convert TIFF images to PNG format upon upload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { saveAttachment } from '@/lib/data-service';
import sharp from 'sharp';
import path from 'path';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const dataUri = formData.get('file') as string;
        const relativePath = formData.get('relativePath') as string;
        const userId = formData.get('userId') as string;
        const originalFileName = formData.get('fileName') as string;

        if (!dataUri || !relativePath || !userId || !originalFileName) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }
        
        let finalDataUri = dataUri;
        let finalRelativePath = relativePath;
        let finalOriginalFileName = originalFileName;

        const isTiff = originalFileName.toLowerCase().endsWith('.tif') || originalFileName.toLowerCase().endsWith('.tiff');

        if (isTiff) {
            try {
                const matches = dataUri.match(/^data:(.*);base64,(.*)$/);
                if (matches) {
                    const buffer = Buffer.from(matches[2], 'base64');
                    // Add failOnError: false to prevent sharp from throwing on unsupported formats
                    const pngBuffer = await sharp(buffer, { failOnError: false }).png().toBuffer();
                    finalDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                    
                    const parsedPath = path.parse(relativePath);
                    finalRelativePath = `${parsedPath.name}.png`;
                    finalOriginalFileName = `${path.parse(originalFileName).name}.png`;
                }
            } catch(conversionError) {
                console.warn(`Could not convert ${originalFileName} to PNG, saving original file instead. Error:`, conversionError);
                // If conversion fails, we just fall back to using the original data.
                // The final* variables are already set to the original values.
            }
        }
        
        const attachmentInfo = await saveAttachment(userId, finalRelativePath, finalDataUri, finalOriginalFileName);

        return NextResponse.json({ attachmentInfo }, { status: 200 });

    } catch (error) {
        console.error('File upload failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ message: `Internal Server Error: ${errorMessage}` }, { status: 500 });
    }
}
