import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { loadTreeNodes, createNode } from '@/lib/data-service';
import { CreateNodeBodySchema, FormatQuerySchema } from '@/lib/api-schemas';
import { TreeNode } from '@/lib/types';
import { generateClientSideId } from '@/lib/utils';
import { connectToDatabase } from '@/lib/mongodb';
import { TreeNodeModel } from '@/lib/models';

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

/**
 * Returns the next available order value for a new node under the given parent.
 * Queries existing siblings and returns max(contextualOrder) + 1, or 0 if none exist.
 */
async function computeNextOrder(treeId: string, parentId: string): Promise<number> {
  await connectToDatabase();
  const siblings = await TreeNodeModel
    .find({ treeId, parentIds: parentId })
    .select('parentIds order')
    .lean<{ parentIds: string[]; order: number[] }[]>();

  if (siblings.length === 0) return 0;

  let max = -1;
  for (const s of siblings) {
    const idx = s.parentIds.indexOf(parentId);
    if (idx !== -1 && s.order[idx] !== undefined) {
      max = Math.max(max, s.order[idx]);
    }
  }
  return max + 1;
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

    // If the caller did not provide an order, compute one server-side so nodes
    // don't all land on position 0. We resolve the order for the first (primary)
    // parent; callers who need multi-parent precision should supply order explicitly.
    const primaryParent = (parentIds ?? ['root'])[0];
    const resolvedOrder = order ?? [await computeNextOrder(String(treeId), primaryParent)];

    const nodeData: Omit<TreeNode, 'id' | 'children'> & { id?: string } = {
      id: id ?? generateClientSideId(),
      name,
      templateId,
      data: data ?? {},
      parentIds: parentIds ?? ['root'],
      order: resolvedOrder,
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
