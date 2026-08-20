/**
 * @fileoverview
 * Shared authentication middleware for all /api/v1/ route handlers.
 *
 * Authentication priority:
 *  1. `Authorization: Bearer <personal_access_token>` header
 *  2. Existing cookie-based JWT session (so the web UI can also call v1 routes)
 *
 * Rate limiting:
 * A simple in-process token bucket is applied per authenticated userId.
 * Limit: 120 requests / 60 seconds (default; may be configurable).
 * This guards against accidental infinite loops in scripts — not exploit mitigation.
 * For multi-instance deployments, replace with a Redis-backed solution.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validatePersonalAccessToken } from './token-service';
import { getSession } from './session';
export function isApiEnabled(): boolean {
  return process.env.ENABLE_API === 'true';
}

function getRateLimitConfig(): { rateLimit: number; windowMs: number } {
  const rateLimit = process.env.API_RATE_LIMIT_REQUESTS ? parseInt(process.env.API_RATE_LIMIT_REQUESTS, 10) : 120;
  const windowSeconds = process.env.API_RATE_LIMIT_WINDOW_SECONDS ? parseInt(process.env.API_RATE_LIMIT_WINDOW_SECONDS, 10) : 60;
  return { rateLimit: isNaN(rateLimit) ? 120 : rateLimit, windowMs: (isNaN(windowSeconds) ? 60 : windowSeconds) * 1000 };
}

// ---------------------------------------------------------------------------
// Rate Limiter (in-process, per userId)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, Bucket>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
  const now = Date.now();
  const { rateLimit, windowMs } = getRateLimitConfig();
  const bucket = rateLimitStore.get(userId);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    // Start a fresh window
    rateLimitStore.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: Math.max(0, rateLimit - 1), resetAt: now + windowMs, limit: rateLimit };
  }

  bucket.count += 1;
  const remaining = Math.max(0, rateLimit - bucket.count);
  const resetAt = bucket.windowStart + windowMs;

  return { allowed: bucket.count <= rateLimit, remaining, resetAt, limit: rateLimit };
}

// Periodically clean up stale buckets to prevent unbounded memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    const { windowMs } = getRateLimitConfig();
    for (const [key, bucket] of rateLimitStore.entries()) {
      if (now - bucket.windowStart >= windowMs * 2) {
        rateLimitStore.delete(key);
      }
    }
  }, 60 * 1000 * 5);
}

// ---------------------------------------------------------------------------
// Main Auth Helper
// ---------------------------------------------------------------------------

export interface ApiAuthResult {
  userId: string;
}

/**
 * Authenticates an incoming /api/v1/ request.
 *
 * Returns `{ userId }` on success.
 * Returns a ready-to-send `NextResponse` (401 or 429) on failure.
 */
export async function authenticateRequest(
  request: NextRequest,
): Promise<ApiAuthResult | NextResponse> {
  if (!isApiEnabled()) {
    return NextResponse.json(
      { error: 'Not Found', message: 'API is disabled.' },
      { status: 404 },
    );
  }
  let userId: string | null = null;

  // 1. Check Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    userId = await validatePersonalAccessToken(rawToken);
  }

  // 2. Fall back to cookie session
  if (!userId) {
    const session = await getSession();
    if (session?.userId) {
      userId = session.userId;
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Provide a valid Bearer token in the Authorization header.' },
      { status: 401 },
    );
  }

  // 3. Rate limit check
  const rl = checkRateLimit(userId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too Many Requests', message: `Rate limit exceeded. Try again after ${new Date(rl.resetAt).toISOString()}.` },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
          'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  return { userId };
}

/**
 * Adds standard rate-limit headers to any successful API response.
 */
export function withRateLimitHeaders(
  response: NextResponse,
  userId: string,
): NextResponse {
  const bucket = rateLimitStore.get(userId);
  if (!bucket) return response;
  const { rateLimit, windowMs } = getRateLimitConfig();
  const remaining = Math.max(0, rateLimit - bucket.count);
  const resetAt = Math.ceil((bucket.windowStart + windowMs) / 1000);
  response.headers.set('X-RateLimit-Limit', String(rateLimit));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset', String(resetAt));
  return response;
}

// ---------------------------------------------------------------------------
// Error sanitisation — prevent internal details from leaking to API clients
// ---------------------------------------------------------------------------

/** Patterns considered safe to expose (case-insensitive substring match). */
const SAFE_ERROR_PATTERNS = [
  'authorization',
  'authentication required',
  'not found',
  'permission',
  'token name is required',
  'validation failed',
] as const;

/**
 * Returns `error.message` if it matches a known-safe pattern, otherwise
 * returns a generic message. This prevents stack traces, DB errors, and
 * other internals from reaching the client.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const msg =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = msg.toLowerCase();
  if (SAFE_ERROR_PATTERNS.some((p) => lower.includes(p))) return msg;
  return 'Internal server error';
}

/**
 * Derives an HTTP status code from a (possibly sanitised) error message.
 */
export function errorStatus(message: string, fallback = 500): number {
  const lower = message.toLowerCase();
  if (lower.includes('authorization') || lower.includes('permission')) return 403;
  if (lower.includes('not found')) return 404;
  return fallback;
}
