/**
 * @fileoverview
 * GET /api/v1  — Discovery endpoint.
 * Returns API version, authentication info, and links to all resources and docs.
 */
import { NextResponse } from 'next/server';
import { isApiEnabled } from '@/lib/api-auth';

export async function GET() {
  if (!isApiEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return NextResponse.json({
    version: '1.0.0',
    description: 'Treelab REST API',
    authentication: {
      scheme: 'Bearer',
      format: 'tlab_<48 hex chars>',
      header: 'Authorization: Bearer <token>',
      manage: '/settings  →  Personal Access Tokens',
    },
    rateLimiting: '120 requests / 60 seconds per user',
    documentation: {
      swaggerUi: '/api/v1/docs',
      redoc: '/api/v1/redoc',
      openApiJson: '/api/v1/openapi',
    },
    resources: {
      tokens: '/api/v1/tokens',
      trees: '/api/v1/trees',
    },
    nodeFormats: {
      flat: '?format=flat  — flat array (default, matches tree.json export)',
      tree: '?format=tree  — hierarchical nested structure',
    },
  });
}
