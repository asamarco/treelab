import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { connectToDatabase } from '@/lib/mongodb';
import { UserModel } from '@/lib/models';

/**
 * GET /api/v1/github/validate-token
 *
 * Validates the GitHub PAT stored for the current user (or an optional
 * ?token= override) by making a lightweight call to the GitHub /user endpoint.
 *
 * Returns:
 *   { valid: true,  login: string }  — token is working
 *   { valid: false }                 — token is missing, expired, or unauthorised
 */
export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    // Allow the caller to supply a token to validate (e.g. while typing a new one
    // in Settings) without persisting it first.
    const { searchParams } = new URL(request.url);
    const overrideToken = searchParams.get('token');

    let token: string | undefined = overrideToken ?? undefined;

    if (!token) {
        // Fall back to the token stored in the user's profile.
        await connectToDatabase();
        const user = await UserModel.findById(session.userId).select('gitSettings').lean().exec();
        token = (user as any)?.gitSettings?.githubPat;
    }

    if (!token) {
        // No token stored — treat as inconclusive (not definitively invalid).
        return NextResponse.json({ valid: null, reason: 'no_token' });
    }

    try {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            // Keep the check fast; if GitHub is unreachable we treat it as inconclusive.
            signal: AbortSignal.timeout(8000),
        });

        if (response.ok) {
            const data = await response.json();
            return NextResponse.json({ valid: true, login: data.login as string });
        }

        // 401 / 403 → definitively invalid; anything else → treat as inconclusive.
        if (response.status === 401 || response.status === 403) {
            return NextResponse.json({ valid: false, reason: 'unauthorized' });
        }

        // Unexpected status — don't flag as invalid, just report inconclusive.
        return NextResponse.json({ valid: null, reason: `http_${response.status}` });
    } catch (err: any) {
        // Network error or timeout — don't penalise the user.
        console.warn('GitHub token validation request failed:', err?.message);
        return NextResponse.json({ valid: null, reason: 'network_error' });
    }
}
