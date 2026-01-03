/**
 * @fileoverview
 * This server-side module manages JWT-based sessions. It provides functions
 * to create, retrieve, and clear secure session cookies, with distinct methods
 * for API Routes and Server Actions.
 */
import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { User } from './types';

const secretKey = process.env.JWT_SECRET_KEY;
if (!secretKey) {
  throw new Error('JWT_SECRET_KEY is not set in environment variables.');
}
const key = new TextEncoder().encode(secretKey);

const SESSION_COOKIE_NAME = 'session';

export async function encrypt(payload: { userId: string, expires: Date }) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h') // Session expires in 12 hours
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
export async function createSessionInApiRoute(response: NextResponse, userId: string) {
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
  const session = await encrypt({ userId, expires });
  
  response.cookies.set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expires,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Creates a session cookie within a Server Action context.
 * It directly calls the cookies() function to set the cookie.
 */
export async function createSessionInServerAction(userId: string) {
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
  const session = await encrypt({ userId, expires });
  
  (await cookies()).set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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

export async function getSession(): Promise<{ userId: string } | null> {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  const decryptedPayload = await decrypt(sessionCookie);
  if (!decryptedPayload?.userId) {
    return null;
  }
  return { userId: decryptedPayload.userId };
}
