import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';
  const isKnownHost =
    hostname.includes('localhost') ||
    hostname.includes('127.0.0.1') ||
    hostname.includes('zyon.com') ||
    hostname.includes('vercel.app');
  if (isKnownHost) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/store/${hostname}${url.pathname === '/' ? '' : url.pathname}`;

  return NextResponse.rewrite(url);
}
export const config = {
  matcher: ['/((?!_next|api|favicon.ico|sitemap.xml|robots.txt).*)'],
};
