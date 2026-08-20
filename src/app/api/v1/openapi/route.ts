/**
 * @fileoverview
 * GET /api/v1/openapi  — serves the full OpenAPI 3.1 specification as JSON.
 *
 * Used by Swagger UI (/api/v1/docs) and ReDoc (/api/v1/redoc) to render
 * interactive documentation. Can also be imported into Postman, Insomnia, etc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateOpenApiDocument } from '@/lib/api-schemas';
import { isApiEnabled } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  if (!isApiEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  //const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`; //Issues with reverse proxy
  const doc = generateOpenApiDocument(''); // relative: resolves against whatever origin loaded the page
  return NextResponse.json(doc, {
    headers: {
      // Allow Swagger UI / ReDoc on other origins to fetch this
      'Access-Control-Allow-Origin': '*',
    },
  });
}
