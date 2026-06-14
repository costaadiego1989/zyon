import type { NextFunction, Request, Response } from "express";

export const PUBLIC_API_VERSION = "v1";
export const PUBLIC_API_PREFIX = `/${PUBLIC_API_VERSION}`;

const LEGACY_EXEMPT_PATHS = [
  "/docs",
  "/openapi.json",
  "/metrics",
];

export function apiVersioningMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (isVersionedRequest(request.url)) {
    request.url = stripPublicApiPrefix(request.url);
    response.setHeader("AACP-API-Version", PUBLIC_API_VERSION);
    next();
    return;
  }

  if (!isLegacyExemptRequest(request.url)) {
    response.setHeader("Deprecation", "true");
    response.setHeader("Link", '</docs>; rel="deprecation"; type="text/html"');
  }

  next();
}

export function stripPublicApiPrefix(url: string): string {
  if (!isVersionedRequest(url)) {
    return url;
  }

  const stripped = url.slice(PUBLIC_API_PREFIX.length);
  return stripped.length === 0 ? "/" : stripped;
}

export function isVersionedRequest(url: string): boolean {
  return url === PUBLIC_API_PREFIX
    || url.startsWith(`${PUBLIC_API_PREFIX}/`)
    || url.startsWith(`${PUBLIC_API_PREFIX}?`);
}

function isLegacyExemptRequest(url: string): boolean {
  const pathname = url.split("?", 1)[0] ?? url;
  return pathname === "/"
    || LEGACY_EXEMPT_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
}
