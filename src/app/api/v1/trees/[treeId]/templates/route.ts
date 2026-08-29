/**
 * @fileoverview
 * GET  /api/v1/trees/[treeId]/templates  — list templates
 * POST /api/v1/trees/[treeId]/templates  — add a template
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { loadTreeFile, saveTreeFile } from '@/lib/data-service';
import { CreateTemplateBodySchema, TemplateSchema } from '@/lib/api-schemas';
import { generateClientSideId } from '@/lib/utils';
import { Template } from '@/lib/types';

type Ctx = { params: Promise<{ treeId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { treeId } = await params;
    const nameFilter = request.nextUrl.searchParams.get('name')?.toLowerCase() ?? '';
    const tree = await loadTreeFile(String(treeId));
    if (!tree) return NextResponse.json({ error: 'Tree not found.' }, { status: 404 });

    const templates = nameFilter
      ? tree.templates.filter((t) => t.name?.toLowerCase().includes(nameFilter))
      : tree.templates;

    return withRateLimitHeaders(
      NextResponse.json({ templates, count: templates.length }),
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

  const parsed = CreateTemplateBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { treeId } = await params;
    const tree = await loadTreeFile(String(treeId));
    if (!tree) return NextResponse.json({ error: 'Tree not found.' }, { status: 404 });

    const { id, name, icon, color, fields, conditionalRules, preferredChildTemplates, nameTemplate, bodyTemplate } = parsed.data;
    const newTemplate: Template = {
      id: id ?? generateClientSideId(),
      name,
      icon,
      color,
      fields: fields ?? [],
      conditionalRules: conditionalRules ?? [],
      preferredChildTemplates: preferredChildTemplates ?? [],
      nameTemplate,
      bodyTemplate,
    };

    await saveTreeFile({ id: String(treeId), templates: [...tree.templates, newTemplate] });
    return withRateLimitHeaders(NextResponse.json({ template: newTemplate }, { status: 201 }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}
