/**
 * @fileoverview
 * This server-side module manages JWT-based sessions. It provides functions
 * to create, retrieve, and clear secure session cookies, with distinct methods
 * for API Routes and Server Actions.
 */
import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { User } from './types';
import { unstable_noStore as noStore } from 'next/cache';
import { connectToDatabase } from './mongodb';
import { UserModel } from './models';
import { validatePersonalAccessToken } from './token-service';

const secretKey = process.env.JWT_SECRET_KEY;
if (!secretKey) {
  throw new Error('JWT_SECRET_KEY is not set in environment variables.');
}
const key = new TextEncoder().encode(secretKey);

const SESSION_COOKIE_NAME = 'session';

// Allow homelab/HTTP deployments to opt out of the Secure cookie flag.
// Defaults to true in production, false in development.
const useSecureCookie = process.env.SECURE_COOKIE !== undefined
  ? process.env.SECURE_COOKIE === 'true'
  : process.env.NODE_ENV === 'production';

function getSessionDurationMs(rememberMe: boolean): number {
  if (rememberMe) {
    const days = process.env.SESSION_REMEMBER_ME_DAYS ? parseInt(process.env.SESSION_REMEMBER_ME_DAYS, 10) : 30;
    return (isNaN(days) ? 30 : days) * 24 * 60 * 60 * 1000;
  }
  const hours = process.env.SESSION_EXPIRY_HOURS ? parseInt(process.env.SESSION_EXPIRY_HOURS, 10) : 12;
  return (isNaN(hours) ? 12 : hours) * 60 * 60 * 1000;
}

export async function encrypt(payload: { userId: string, expires: Date, rememberMe?: boolean, sessionVersion?: number }) {
  const expiryTime = payload.rememberMe 
    ? `${Math.round(getSessionDurationMs(true) / (24 * 60 * 60 * 1000))}d`
    : `${Math.round(getSessionDurationMs(false) / (60 * 60 * 1000))}h`;

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiryTime)
    .sign(key);
}

export async function decrypt(input: string): Promise<any> {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ['HS256'],
    });
    return payload;
  } catch (error) {
    console.warn('JWT verification failed:', (error as Error).message);
    return null;
  }
}

/**
 * Creates a session cookie within an API Route context.
 * It modifies the cookies on the NextResponse object.
 */
export async function createSessionInApiRoute(response: NextResponse, userId: string, rememberMe: boolean = false) {
  const expiresInMs = getSessionDurationMs(rememberMe);
  const expires = new Date(Date.now() + expiresInMs);
  
  await connectToDatabase();
  const user = await UserModel.findById(userId).select('sessionVersion').lean().exec();
  const sessionVersion = user?.sessionVersion || 0;

  const session = await encrypt({ userId, expires, rememberMe, sessionVersion });
  
  response.cookies.set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: useSecureCookie,
    expires: expires,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Creates a session cookie within a Server Action context.
 * It directly calls the cookies() function to set the cookie.
 */
export async function createSessionInServerAction(userId: string, rememberMe: boolean = false) {
  const expiresInMs = getSessionDurationMs(rememberMe);
  const expires = new Date(Date.now() + expiresInMs);
  
  await connectToDatabase();
  const user = await UserModel.findById(userId).select('sessionVersion').lean().exec();
  const sessionVersion = user?.sessionVersion || 0;

  const session = await encrypt({ userId, expires, rememberMe, sessionVersion });
  
  (await cookies()).set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: useSecureCookie,
    expires: expires,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Clears the session cookie. This function is designed to be used in API Routes
 * by passing the response object.
 */
export function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, expires: new Date(0) });
}

export async function getSession(): Promise<{ userId: string, rememberMe?: boolean } | null> {
  // Prevent caching of the session
  noStore();

  // 0. If authentication is disabled, treat every request as the default user.
  if (process.env.REQUIRE_AUTHENTICATION === 'false') {
    const defaultUserId = process.env.USERID || 'test';
    return { userId: defaultUserId };
  }

  // 1. Check for Personal Access Token in Authorization header
  const authHeader = (await headers()).get('authorization');
  if (authHeader && authHeader.startsWith('Bearer tlab_')) {
    const token = authHeader.substring(7);
    const userId = await validatePersonalAccessToken(token);
    if (userId) {
      return { userId, rememberMe: false };
    }
  }
  
  // 2. Fallback to cookie
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  const decryptedPayload = await decrypt(sessionCookie);
  if (!decryptedPayload?.userId) {
    return null;
  }
  
  await connectToDatabase();
  const user = await UserModel.findById(decryptedPayload.userId).select('sessionVersion').lean().exec();
  
  const payloadVersion = decryptedPayload.sessionVersion || 0;
  const userVersion = user?.sessionVersion || 0;
  
  if (payloadVersion !== userVersion) {
    return null;
  }

  return { userId: decryptedPayload.userId, rememberMe: decryptedPayload.rememberMe };
}
