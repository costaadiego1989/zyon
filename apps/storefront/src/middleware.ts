import { isPlatformHostname, storefrontRequestHostname } from './lib/platform-hostname';
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = storefrontRequestHostname(request.headers.get('host'), request.nextUrl.hostname);
  const isKnownHost = isPlatformHostname(hostname, process.env.RAILWAY_PUBLIC_DOMAIN);
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
