import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ path: string[] }> };

function isIdentifier(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{1,200}$/.test(value));
}

function isAllowedPath(path: string[]): boolean {
  if (path[0] === "nudge") return path.length === 1;
  if (path[0] === "conversations") {
    return path.length === 3 && isIdentifier(path[1]) && ["messages", "one-buy-click", "access", "history"].includes(path[2]!);
  }
  if (path[0] !== "cart" || !isIdentifier(path[1])) return false;
  return path.length === 2 ||
    (path.length === 3 && path[2] === "clear") ||
    (path.length === 4 && path[2] === "items" && isIdentifier(path[3]));
}

function requestHasVerifiedStorefrontOrigin(request: Request, origin: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return request.headers.get("origin") === origin;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function proxy(request: Request, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  if (!isAllowedPath(path)) return NextResponse.json({ error: "route_not_allowed" }, { status: 404 });

  const origin = new URL(request.url).origin;
  if (!requestHasVerifiedStorefrontOrigin(request, origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.match(/^Bearer \S+$/i)) {
    return NextResponse.json({ error: "conversation_access_required" }, { status: 401 });
  }

  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const apiBase = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
  if (!serviceToken) return NextResponse.json({ error: "service_not_configured" }, { status: 503 });

  const requestUrl = new URL(request.url);
  const targetPath = path.map(encodeURIComponent).join("/");
  const headers = new Headers({
    Authorization: authorization,
    "X-Internal-Service-Token": serviceToken,
    "X-Trusted-Storefront-Origin": origin,
  });
  const contentType = request.headers.get("content-type");
  const buyerAuthorization = request.headers.get("x-buyer-authorization");
  if (contentType) headers.set("Content-Type", contentType);
  if (buyerAuthorization) headers.set("X-Buyer-Authorization", buyerAuthorization);

  try {
    const response = await fetch(`${apiBase}/storefront/${targetPath}${requestUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const responseContentType = response.headers.get("content-type");
    if (responseContentType) responseHeaders.set("Content-Type", responseContentType);
    for (const name of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new NextResponse(await response.text(), { status: response.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: "storefront_proxy_unavailable" }, { status: 502 });
  }
}

export function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}
