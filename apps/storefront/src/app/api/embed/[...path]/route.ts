import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ path: string[] }> };

function isPathSegment(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{1,200}$/.test(value));
}

function isAllowedEmbedPath(path: string[]): boolean {
  return path.length > 0 && path.length <= 6 && path.every(isPathSegment);
}

function requestHasVerifiedStorefrontOrigin(request: Request, origin: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return request.headers.get("origin") === origin;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function proxy(request: Request, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  if (!isAllowedEmbedPath(path)) {
    return NextResponse.json({ error: "route_not_allowed" }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  if (!requestHasVerifiedStorefrontOrigin(request, origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.match(/^Bearer \S+$/i)) {
    return NextResponse.json({ error: "embed_session_required" }, { status: 401 });
  }

  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const apiBase = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
  if (!serviceToken) {
    return NextResponse.json({ error: "service_not_configured" }, { status: 503 });
  }

  const requestUrl = new URL(request.url);
  const targetPath = path.map(encodeURIComponent).join("/");
  const headers = new Headers({
    Authorization: authorization,
    "X-Internal-Service-Token": serviceToken,
    "X-Trusted-Storefront-Origin": origin,
  });
  for (const name of ["content-type", "idempotency-key", "x-buyer-authorization"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/embed/${targetPath}${requestUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const contentType = response.headers.get("content-type");
    if (contentType) responseHeaders.set("Content-Type", contentType);
    for (const name of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new NextResponse(await response.text(), { status: response.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: "embed_proxy_unavailable" }, { status: 502 });
  }
}

export function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}
