/**
 * @fileoverview
 * PUT    /api/v1/trees/[treeId]/templates/[templateId]  — replace a template
 * DELETE /api/v1/trees/[treeId]/templates/[templateId]  — remove a template
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { loadTreeFile, saveTreeFile } from '@/lib/data-service';
import { CreateTemplateBodySchema } from '@/lib/api-schemas';
import { Template } from '@/lib/types';

type Ctx = { params: Promise<{ treeId: string; templateId: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = CreateTemplateBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { treeId, templateId } = await params;
    const tree = await loadTreeFile(String(treeId));
    if (!tree) return NextResponse.json({ error: 'Tree not found.' }, { status: 404 });

    const idx = tree.templates.findIndex((t) => t.id === String(templateId));
    if (idx === -1) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });

    const existing = tree.templates[idx];
    const { name, icon, color, fields, conditionalRules, preferredChildTemplates, nameTemplate, bodyTemplate } = parsed.data;
    const updated: Template = {
      id: String(templateId), // ID is immutable
      name: name ?? existing.name,
      icon: icon ?? existing.icon,
      color: color ?? existing.color,
      fields: fields ?? existing.fields,
      conditionalRules: conditionalRules ?? existing.conditionalRules,
      preferredChildTemplates: preferredChildTemplates ?? existing.preferredChildTemplates,
      nameTemplate: nameTemplate ?? existing.nameTemplate,
      bodyTemplate: bodyTemplate ?? existing.bodyTemplate,
    };

    const updatedTemplates = [...tree.templates];
    updatedTemplates[idx] = updated;
    await saveTreeFile({ id: String(treeId), templates: updatedTemplates });

    return withRateLimitHeaders(NextResponse.json({ template: updated }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { treeId, templateId } = await params;
    const tree = await loadTreeFile(String(treeId));
    if (!tree) return NextResponse.json({ error: 'Tree not found.' }, { status: 404 });

    const filtered = tree.templates.filter((t) => t.id !== String(templateId));
    if (filtered.length === tree.templates.length) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
    }

    await saveTreeFile({ id: String(treeId), templates: filtered });
    return withRateLimitHeaders(NextResponse.json({ message: 'Template deleted.' }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}
