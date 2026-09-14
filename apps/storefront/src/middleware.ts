import { isPlatformHostname } from './lib/platform-hostname';
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase().replace(/\.$/, '');
  const isKnownHost = isPlatformHostname(hostname);
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
