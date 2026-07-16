/**
 * @fileoverview
 * GET  /api/v1/trees/[treeId]/nodes        — list nodes (?format=flat|tree)
 * POST /api/v1/trees/[treeId]/nodes        — create a node
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { loadTreeNodes, createNode } from '@/lib/data-service';
import { CreateNodeBodySchema, FormatQuerySchema } from '@/lib/api-schemas';
import { TreeNode } from '@/lib/types';
import { generateClientSideId } from '@/lib/utils';

type Ctx = { params: Promise<{ treeId: string }> };

/** Recursively flatten a hierarchical tree into a flat array (removes children key). */
function flattenNodes(nodes: TreeNode[]): Omit<TreeNode, 'children'>[] {
  const result: Omit<TreeNode, 'children'>[] = [];
  const traverse = (list: TreeNode[]) => {
    for (const node of list) {
      const { children, ...rest } = node;
      result.push(rest);
      if (children?.length) traverse(children);
    }
  };
  traverse(nodes);
  return result;
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { treeId } = await params;
    const format = FormatQuerySchema.safeParse(request.nextUrl.searchParams.get('format') ?? 'flat');
    if (!format.success) {
      return NextResponse.json({ error: 'Invalid format. Use "flat" or "tree".' }, { status: 400 });
    }
    const hierarchicalNodes = await loadTreeNodes(String(treeId));
    const responseNodes = format.data === 'tree' ? hierarchicalNodes : flattenNodes(hierarchicalNodes);

    return withRateLimitHeaders(
      NextResponse.json({ nodes: responseNodes, count: responseNodes.length, format: format.data }),
      auth.userId,
    );
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = CreateNodeBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { treeId } = await params;
    const { name, templateId, id, data, parentIds, order, isStarred } = parsed.data;

    const nodeData: Omit<TreeNode, 'id' | 'children'> & { id?: string } = {
      id: id ?? generateClientSideId(),
      name,
      templateId,
      data: data ?? {},
      parentIds: parentIds ?? ['root'],
      order: order ?? [0],
      treeId: String(treeId),
      userId: auth.userId,
      isStarred: isStarred ?? false,
    };

    const created = await createNode(nodeData);
    return withRateLimitHeaders(NextResponse.json({ node: created }, { status: 201 }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg, 400) });
  }
}
