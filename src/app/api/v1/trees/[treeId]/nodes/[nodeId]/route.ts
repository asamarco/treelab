/**
 * @fileoverview
 * GET    /api/v1/trees/[treeId]/nodes/[nodeId]  — get a single node
 * PATCH  /api/v1/trees/[treeId]/nodes/[nodeId]  — update node content fields
 * DELETE /api/v1/trees/[treeId]/nodes/[nodeId]  — delete node + descendants
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { findNodeById, updateNode, deleteNodeWithChildren } from '@/lib/data-service';
import { PatchNodeBodySchema } from '@/lib/api-schemas';

type Ctx = { params: Promise<{ treeId: string; nodeId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { nodeId } = await params;
    const node = await findNodeById(String(nodeId));
    if (!node) return NextResponse.json({ error: 'Node not found.' }, { status: 404 });

    const { children, ...rest } = node as any;
    return withRateLimitHeaders(NextResponse.json({ node: rest }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = PatchNodeBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  // Schema-level .refine() already enforces ≥1 field — no manual check needed.
  const updates = parsed.data as Record<string, any>;

  try {
    const { nodeId } = await params;
    const timestamp = await updateNode(String(nodeId), updates);
    return withRateLimitHeaders(
      NextResponse.json({ message: 'Node updated.', updatedAt: timestamp }),
      auth.userId,
    );
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { nodeId } = await params;
    const result = await deleteNodeWithChildren(String(nodeId), null);
    return withRateLimitHeaders(
      NextResponse.json({ message: 'Node deleted.', deletedIds: result.deletedIds, deletedAt: result.newTimestamp }),
      auth.userId,
    );
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}
