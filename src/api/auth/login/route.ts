/**
 * @fileoverview
 * This API route handles user login. It receives user credentials,
 * validates them, and if successful, generates a JWT and sets it
 * in a secure, HTTP-only cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateLogin } from '@/lib/auth-service';
import { createSessionInApiRoute } from '@/lib/session';

export async function POST(request: NextRequest) {
    try {
        const { identifier, password } = await request.json();

        if (!identifier || !password) {
            return NextResponse.json({ message: 'Username and password are required' }, { status: 400 });
        }
        
        const user = await validateLogin(identifier, password);

        if (!user) {
            return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
        }

        const response = NextResponse.json(user);

        // Create session and set cookie
        await createSessionInApiRoute(response, user.id);

        return response;

    } catch (error) {
        console.error('Login API error:', error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
