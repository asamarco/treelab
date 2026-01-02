
/**
 * @fileoverview
 * This API route handles all file uploads from the client (both pictures and attachments).
 * It receives form data containing the file, saves it to the user's
 * private `attachments` directory, and returns the web-accessible path and metadata.
 * It now includes logic to convert TIFF images to PNG format upon upload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { saveAttachment } from '@/lib/data-service';
import sharp from 'sharp';
import path from 'path';
import { getSession } from '@/lib/session';

export async function POST(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.userId) {
            return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
        }
        const userId = session.userId;

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const uniqueFileName = formData.get('uniqueFileName') as string;
        const originalFileName = formData.get('fileName') as string;

        if (!file || !uniqueFileName || !originalFileName) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }
        
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        
        let finalDataUri: string;
        let finalRelativePath = uniqueFileName;
        let finalOriginalFileName = originalFileName;

        const isTiff = originalFileName.toLowerCase().endsWith('.tif') || originalFileName.toLowerCase().endsWith('.tiff');

        if (isTiff) {
            try {
                const pngBuffer = await sharp(buffer, { failOnError: false }).png().toBuffer();
                finalDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                
                const parsedPath = path.parse(uniqueFileName);
                finalRelativePath = `${parsedPath.name}.png`;
                finalOriginalFileName = `${path.parse(originalFileName).name}.png`;
            } catch(conversionError) {
                console.warn(`Could not convert ${originalFileName} to PNG, saving original file instead. Error:`, conversionError);
                finalDataUri = `data:${file.type};base64,${buffer.toString('base64')}`;
            }
        } else {
             finalDataUri = `data:${file.type};base64,${buffer.toString('base64')}`;
        }
        
        const attachmentInfo = await saveAttachment(userId, finalRelativePath, finalDataUri, finalOriginalFileName);

        return NextResponse.json({ attachmentInfo }, { status: 200 });

    } catch (error) {
        console.error('File upload failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ message: `Internal Server Error: ${errorMessage}` }, { status: 500 });
    }
}
