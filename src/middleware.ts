/**
 * @fileoverview
 * This middleware provides an application-wide security layer.
 *
 * It implements two main security features:
 * 1.  URL Path Validation: Proactively blocks requests with URLs containing characters
 *     commonly used in injection attacks (e.g., <, >).
 * 2.  Nonce-based Content Security Policy (CSP): Generates a unique nonce for each
 *     request and sets a strict CSP header. This ensures that only authorized inline
 *     scripts can be executed, providing a strong defense against XSS.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
 
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. URL Path Validation
  const maliciousCharsRegex = /[<>"';()]/;

  if (maliciousCharsRegex.test(decodeURIComponent(pathname))) {
    console.warn(`WARN: Blocked potentially malicious request to path: ${pathname}`);
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // 2. Nonce-based Content Security Policy & Security Headers
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV === 'development';

  const cspHeader = [
    `default-src 'self'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data:`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDevelopment ? "'unsafe-eval'" : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `connect-src 'self' *.cloudworkstations.dev api.github.com`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  
  // Set all security headers on the response
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
 
  return response;
}
 
export const config = {
  matcher: [
    // Apply middleware to all paths except for static files and API routes
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ]
}
