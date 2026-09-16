import { isPlatformHostname, storefrontRequestHostname } from './lib/platform-hostname';
import { NextRequest, NextResponse } from 'next/server';

function protectRecovery(request: NextRequest, response: NextResponse) {
  if (request.nextUrl.searchParams.has("recovery")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const hostname = storefrontRequestHostname(request.headers.get('host'), request.nextUrl.hostname);
  const isKnownHost = isPlatformHostname(hostname, process.env.RAILWAY_PUBLIC_DOMAIN);
  if (isKnownHost) {
    return protectRecovery(request, NextResponse.next());
  }

  const url = request.nextUrl.clone();
  url.pathname = `/store/${hostname}${url.pathname === '/' ? '' : url.pathname}`;

  return protectRecovery(request, NextResponse.rewrite(url));
}
export const config = {
  matcher: ['/((?!_next|api|favicon.ico|sitemap.xml|robots.txt).*)'],
};
