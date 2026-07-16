/**
 * @fileoverview
 * GET    /api/v1/trees/[treeId]  — tree metadata + templates (no nodes)
 * PATCH  /api/v1/trees/[treeId]  — update title / settings
 * DELETE /api/v1/trees/[treeId]  — delete tree and all nodes
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { loadTreeFile, saveTreeFile, deleteTreeFile } from '@/lib/data-service';
import { PatchTreeBodySchema } from '@/lib/api-schemas';

type Ctx = { params: Promise<{ treeId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { treeId } = await params;
    const tree = await loadTreeFile(String(treeId));
    if (!tree) return NextResponse.json({ error: 'Tree not found.' }, { status: 404 });

    const { tree: _nodes, ...meta } = tree;
    return withRateLimitHeaders(
      NextResponse.json({ tree: { ...meta, nodeCount: _nodes?.length ?? 0 } }),
      auth.userId,
    );
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = PatchTreeBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { treeId } = await params;
  // Only forward the whitelisted keys that were actually supplied
  // (Schema-level .refine() already enforces ≥1 field)
  const allowed = ['title', 'isPublic', 'templates', 'expandedNodeIds'] as const;
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (key in parsed.data) updates[key] = (parsed.data as any)[key];
  }

  try {
    await saveTreeFile({ id: String(treeId), ...updates });
    return withRateLimitHeaders(NextResponse.json({ message: 'Tree updated.' }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { treeId } = await params;
    await deleteTreeFile(String(treeId));
    return withRateLimitHeaders(NextResponse.json({ message: 'Tree deleted.' }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}
