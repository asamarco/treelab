/**
 * @fileoverview
 * This middleware provides an application-wide security layer to proactively
 * block potential Cross-Site Scripting (XSS) attacks.
 *
 * It inspects the pathname of every incoming request. If the path contains
 * characters commonly used in HTML injection attacks (like '<' or '>'),
 * it intercepts the request and redirects the user to the homepage.
 * This prevents malicious URLs from ever reaching the Next.js rendering engine.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
 
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check the decoded pathname for malicious characters.
  if (pathname.includes('<') || pathname.includes('>')) {
    console.warn(`WARN: Blocked potentially malicious request to path: ${pathname}`);
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Also check the raw, encoded URL for encoded malicious characters.
  if (request.url.includes('%3C') || request.url.includes('%3E')) {
     console.warn(`WARN: Blocked potentially malicious request with encoded characters: ${request.url}`);
     const url = request.nextUrl.clone();
     url.pathname = '/';
     return NextResponse.redirect(url);
  }
 
  // Allow the request to proceed if it's clean.
  return NextResponse.next()
}
 
// See "Matching Paths" below to learn more
export const config = {
  matcher: '/:path*',
}
