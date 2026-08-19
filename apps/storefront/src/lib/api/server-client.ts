/**
 * SERVER-SIDE API client — for Next.js Server Components, generateMetadata, etc.
 *
 * Unlike the client-side api-client.ts (uses /api/v1 proxy),
 * this calls the API directly with the service API key.
 *
 * Only import this in server components / route handlers.
 */

const API_BASE_URL = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
const API_KEY = process.env.AACP_SERVICE_API_KEY || "";

const USE_V1_SETTINGS = process.env.NEXT_PUBLIC_USE_V1_SETTINGS === "true";

interface ApiEnvelope<T> {
  data: T;
  meta: { request_id: string; timestamp: string; version: string };
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

/** Fetch store config — v1 or internal */
export async function fetchStoreConfig(slug: string): Promise<any | null> {
  if (USE_V1_SETTINGS) {
    const envelope = await serverFetch(`${API_BASE_URL}/v1/settings/store`) as ApiEnvelope<any> | null;
    return envelope?.data ?? null;
  }
  return serverFetch(`${API_BASE_URL}/storefront/${slug}/config`);
}

/** Fetch store stories — internal only (no v1 equivalent) */
export async function fetchStoreStories(slug: string): Promise<any[]> {
  const data = await serverFetch(`${API_BASE_URL}/storefront/${slug}/stories`);
  return data?.categories ?? [];
}

/** Fetch sitemap index — products for SEO */
export async function fetchSitemapProducts(): Promise<Array<{ slug: string; updatedAt: string }>> {
  if (USE_V1_SETTINGS) {
    // Use v1 products endpoint with high limit
    const envelope = await serverFetch(`${API_BASE_URL}/v1/products?limit=100`) as ApiEnvelope<any[]> | null;
    if (!envelope?.data) return [];
    return envelope.data.map((p: any) => ({
      slug: p.slug || p.id,
      updatedAt: p.updated_at || p.created_at || new Date().toISOString(),
    }));
  }
  const data = await serverFetch(`${API_BASE_URL}/storefront/index`);
  return data?.items ?? [];
}
