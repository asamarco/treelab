/**
 * @fileoverview
 * This file defines an API route handler to serve static attachment assets.
 * Similar to the pictures route, this is needed because attachments are stored
 * in a private `data` directory. This handler reads the requested file
 * from the filesystem and returns it with the appropriate content type and a
 * `Content-Disposition` header to prompt a download.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { lookup } from 'mime-types';

export async function GET(request: NextRequest, { params }: any) {
  const { slug } = params;

  if (!slug || slug.length === 0) {
    return new NextResponse('Invalid file path', { status: 400 });
  }

  const userId = slug[0];
  const fileName = slug[slug.length - 1];

  // Basic security check: prevent directory traversal
  if (slug.some((part: string) => part.includes('..'))) {
    return new NextResponse('Invalid file path', { status: 400 });
  }

  // Extract original filename for the download prompt from query parameter
  const searchParams = request.nextUrl.searchParams;
  const originalFileName = searchParams.get('name') || fileName;

  const attachmentsDir = path.resolve(
    process.cwd(),
    process.env.DATA_DIR || 'data',
    'users',
    userId,
    'attachments'
  );
  const filePath = path.resolve(attachmentsDir, fileName);

  // Security check: Ensure the resolved path is within the intended directory
  if (!filePath.startsWith(attachmentsDir)) {
    return new NextResponse('Access denied', { status: 403 });
  }

  try {
    const fileBuffer = await fs.readFile(filePath);
    const contentType = lookup(filePath) || 'application/octet-stream';

    const headers = new Headers();
    headers.set('Content-Type', contentType);

    // If it's an image, display it inline. Otherwise, prompt for download.
    if (contentType.startsWith('image/')) {
      headers.set(
        'Content-Disposition',
        `inline; filename="${originalFileName}"`
      );
    } else {
      headers.set(
        'Content-Disposition',
        `attachment; filename="${originalFileName}"`
      );
    }

    headers.set('Cache-Control', 'private, max-age=31536000, immutable');

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new NextResponse('Attachment not found', { status: 404 });
    }
    console.error(`Failed to serve attachment ${slug.join('/')}:`, error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
