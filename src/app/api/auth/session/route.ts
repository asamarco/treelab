/**
 * @fileoverview
 * This API route checks for a valid user session by verifying the
 * JWT stored in the session cookie. If the session is valid, it returns
 * the current user's data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchUsers } from '@/lib/auth-service';

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (session?.userId) {
    // In a real app, you'd fetch the user from the DB without the password hash.
    // For this context, we'll fetch all and find the user.
    const allUsers = await fetchUsers();
    const user = allUsers.find(u => u.id === session.userId);

    if (user) {
      return NextResponse.json(user);
    }
  }

  return NextResponse.json(null, { status: 401 });
}
