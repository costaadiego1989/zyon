/**
 * URL building utilities for dashboard API client.
 * Handles normalization, versioning, and merging of base URLs with paths.
 */

export function normalizeApiBase(url: string): string {
  return url.trimEnd().replace(/\/+$/, "");
}

function mergePath(urlPath: string): string {
  const trimmed = urlPath.trim().replace(/^\/+/, "");
  return `/${trimmed}`;
}

function versionedPath(path: string): string {
  const normalized = mergePath(path);
  return normalized === "/v1" || normalized.startsWith("/v1/")
    ? normalized
    : `/v1${normalized}`;
}

/**
 * Merge base URL with a path, handling versioning.
 * Examples:
 *   - mergeUrl("http://api.test", "/orders") → "http://api.test/v1/orders"
 *   - mergeUrl("http://api.test/v1", "/orders") → "http://api.test/v1/orders"
 *   - mergeUrl("http://api.test///", "//orders") → "http://api.test/v1/orders"
 */
export function mergeUrl(baseUrl: string, path: string): string {
  const base = normalizeApiBase(baseUrl);
  const normalizedPath = versionedPath(path);
  return base.endsWith("/v1")
    ? `${base}${normalizedPath.slice(3)}`
    : `${base}${normalizedPath}`;
}
