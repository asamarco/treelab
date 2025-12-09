/**
 * @fileoverview
 * This API route handles user logout by clearing the session cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ message: 'Logged out successfully' });
  clearSession(response);
  return response;
}
