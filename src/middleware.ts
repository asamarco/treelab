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
  const url = request.url;

  // Define a regex for characters commonly used in XSS attacks.
  // This blocks <, >, ", ', ;, (, )
  const maliciousCharsRegex = /[<>"';()]/;

  // Define a regex for the encoded versions of those characters.
  const encodedMaliciousCharsRegex = /%3C|%3E|%22|%27|%3B|%28|%29/i;

  // Check the decoded pathname for malicious characters.
  if (maliciousCharsRegex.test(pathname)) {
    console.warn(`WARN: Blocked potentially malicious request to path: ${pathname}`);
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Also check the raw, encoded URL for encoded malicious characters.
  if (encodedMaliciousCharsRegex.test(url)) {
     console.warn(`WARN: Blocked potentially malicious request with encoded characters: ${url}`);
     const redirectUrl = request.nextUrl.clone();
     redirectUrl.pathname = '/';
     return NextResponse.redirect(redirectUrl);
  }
 
  // Allow the request to proceed if it's clean.
  return NextResponse.next()
}
 
// See "Matching Paths" below to learn more
export const config = {
  matcher: '/:path*',
}
