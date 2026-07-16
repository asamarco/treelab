/**
 * @fileoverview
 * DELETE /api/v1/tokens/[tokenId]  — revoke a Personal Access Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, withRateLimitHeaders, sanitizeErrorMessage, errorStatus } from '@/lib/api-auth';
import { revokePersonalAccessToken } from '@/lib/token-service';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { tokenId } = await params;
    await revokePersonalAccessToken(String(tokenId));
    return withRateLimitHeaders(
      NextResponse.json({ message: 'Token revoked.' }),
      auth.userId,
    );
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) });
  }
}
