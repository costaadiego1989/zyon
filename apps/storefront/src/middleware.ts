import { NextRequest, NextResponse } from 'next/server';

/**
 * Storefront middleware for custom domain resolution.
 * When a request comes from a non-Zyon domain (custom merchant domain),
 * it rewrites the URL to /store/[domain] internally.
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';

  // Skip internal Next.js routes, localhost, and known platform domains
  const isKnownHost =
    hostname.includes('localhost') ||
    hostname.includes('127.0.0.1') ||
    hostname.includes('zyon.com') ||
    hostname.includes('vercel.app');

  if (isKnownHost) {
    return NextResponse.next();
  }

  // Custom domain detected: rewrite to /store/[domain] path
  const url = request.nextUrl.clone();
  url.pathname = `/store/${hostname}${url.pathname === '/' ? '' : url.pathname}`;

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|sitemap.xml|robots.txt).*)'],
};
