/**
 * @fileoverview
 * GET /api/v1/docs  — Swagger UI interactive documentation page.
 *
 * No authentication required to view the docs page itself.
 * The "Authorize" button in Swagger UI lets users enter their Bearer token
 * and try every endpoint directly from the browser.
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
  <title>Treelab API — Swagger UI</title>
  <meta name="description" content="Interactive documentation for the Treelab REST API." />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    /* Clean up default Swagger UI chrome to match a professional look */
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { background: #0f172a; padding: 10px 0; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .topbar-wrapper .link { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .swagger-ui .topbar-wrapper img { display: none; }
    .swagger-ui .topbar-wrapper::after {
      content: "Treelab API";
      color: #fff;
      font-size: 1.25rem;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      padding-left: 24px;
    }
    .swagger-ui .info .title { font-size: 2rem; }
    .swagger-ui .scheme-container { background: #fff; box-shadow: none; border-bottom: 1px solid #e2e8f0; }
    /* Tag groups */
    .swagger-ui .opblock-tag { font-size: 1.1rem; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>

  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: "#swagger-ui",
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset,
        ],
        layout: "StandaloneLayout",
        deepLinking: true,
        displayRequestDuration: true,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        tryItOutEnabled: true,
        filter: true,
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
