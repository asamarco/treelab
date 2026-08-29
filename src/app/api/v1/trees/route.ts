/**
 * @fileoverview
 * POST /api/v1/trees  — create a new tree
 * GET  /api/v1/trees  — list all trees accessible to the caller
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { loadAllTreeFiles, createTreeFile } from '@/lib/data-service';
import { CreateTreeBodySchema } from '@/lib/api-schemas';
import { TreeFile } from '@/lib/types';
import { generateClientSideId } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const nameFilter = request.nextUrl.searchParams.get('name')?.toLowerCase() ?? '';
    const trees = await loadAllTreeFiles();
    const summary = trees
      .filter((t: TreeFile) => !nameFilter || t.title?.toLowerCase().includes(nameFilter))
      .map((t: TreeFile) => ({
        id: t.id,
        title: t.title,
        isPublic: t.isPublic,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        templateCount: t.templates?.length ?? 0,
        nodeCount: t.tree?.length ?? 0,
      }));
    return withRateLimitHeaders(NextResponse.json({ trees: summary, count: summary.length }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = CreateTreeBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { title, isPublic, templates } = parsed.data;
    const treeData: Omit<TreeFile, 'tree' | 'id'> = {
      userId: auth.userId,
      title,
      templates: (templates ?? []).map((t: any) => ({ ...t, id: t.id ?? generateClientSideId() })),
      expandedNodeIds: [],
      isPublic: isPublic ?? false,
      sharedWith: [],
      shares: [],
      teamShares: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
    };
    const created = await createTreeFile(treeData, []);
    return withRateLimitHeaders(NextResponse.json({ tree: created }, { status: 201 }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg, 400) });
  }
}
