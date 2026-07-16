/**
 * @fileoverview
 * GET  /api/v1/tokens  — list caller's Personal Access Tokens
 * POST /api/v1/tokens  — create a new PAT (returns raw token once)
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { listPersonalAccessTokens, createPersonalAccessToken } from '@/lib/token-service';
import { CreateTokenBodySchema } from '@/lib/api-schemas';

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const tokens = await listPersonalAccessTokens();
    return withRateLimitHeaders(NextResponse.json({ tokens }), auth.userId);
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = CreateTokenBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createPersonalAccessToken(parsed.data.name, parsed.data.expiresAt);
    return withRateLimitHeaders(
      NextResponse.json(
        { token: result.token, rawToken: result.rawToken, notice: 'Store this token securely — it will not be shown again.' },
        { status: 201 },
      ),
      auth.userId,
    );
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg, 400) });
  }
}
