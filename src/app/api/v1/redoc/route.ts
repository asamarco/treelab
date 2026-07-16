/**
 * @fileoverview
 * GET /api/v1/redoc  — ReDoc documentation page (alternative to Swagger UI).
 *
 * ReDoc renders a clean, three-panel read-only view of the API spec.
 * Great for sharing with stakeholders or embedding in project wikis.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isApiEnabled } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  if (!isApiEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  const specUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}/api/v1/openapi`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Treelab API — ReDoc</title>
  <meta name="description" content="ReDoc documentation for the Treelab REST API." />
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <redoc
    spec-url="${specUrl}"
    expand-responses="200,201"
    hide-download-button
    sort-props-alphabetically
  ></redoc>
  <script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
