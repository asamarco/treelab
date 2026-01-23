/**
 * @fileoverview
 * This API route handles user logout by clearing the session cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ message: 'Logged out successfully' });
  // Also clear the cookie from the server-side perspective
  clearSession(response);
  return response;
}
