/**
 * SERVER-SIDE API client — for Next.js Server Components, generateMetadata, etc.
 *
 * Calls v1 API directly with service API key (server-side only).
 * Never import this from client components.
 */

const API_BASE_URL = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
const API_KEY = process.env.AACP_SERVICE_API_KEY || "";

interface ApiEnvelope<T> {
  data: T;
  meta: { request_id: string; timestamp: string; version: string };
  pagination?: { next_cursor: string | null; has_more: boolean };
}

async function serverFetch(url: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }

  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...options?.headers as Record<string, string> },
    cache: "no-store",
  });

  if (!res.ok) return null;
  return res.json();
}

/** Fetch store config via v1 API */
export async function fetchStoreConfig(slug: string): Promise<any | null> {
  const envelope = await serverFetch(`${API_BASE_URL}/v1/settings/store`) as ApiEnvelope<any> | null;
  return envelope?.data ?? null;
}

/** Fetch store stories — internal only (no v1 equivalent) */
export async function fetchStoreStories(slug: string): Promise<any[]> {
  // Stories are storefront-specific CMS content, not in public API
  const data = await serverFetch(`${API_BASE_URL}/storefront/${slug}/stories`);
  return data?.categories ?? [];
}

/** Fetch products for sitemap generation */
export async function fetchSitemapProducts(): Promise<Array<{ slug: string; updatedAt: string }>> {
  const envelope = await serverFetch(`${API_BASE_URL}/v1/products?limit=100`) as ApiEnvelope<any[]> | null;
  if (!envelope?.data) return [];
  return envelope.data.map((p: any) => ({
    slug: p.slug || p.id,
    updatedAt: p.updated_at || p.created_at || new Date().toISOString(),
  }));
}
