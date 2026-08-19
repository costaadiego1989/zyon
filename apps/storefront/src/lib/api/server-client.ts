/**
 * SERVER-SIDE API client — for Next.js Server Components (SSR).
 *
 * IMPORTANT: Our storefront is MULTI-TENANT (serves many merchants by slug).
 * v1 API keys are per-merchant, so SSR config loading uses internal routes
 * that resolve merchant by slug. Client-side uses embed token for tenant context.
 *
 * This is the correct pattern:
 * - SSR: internal route (resolve slug → merchant config)
 * - Client: /api/v1 proxy with embed token (tenant derived from token)
 *
 * External customers (single-tenant) use their own API key for everything.
 */

const API_BASE_URL = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";

async function serverFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers as Record<string, string>,
    },
    cache: "no-store",
  });

  if (!res.ok) return null;
  return res.json();
}

/** Fetch store config by slug — internal route (multi-tenant resolution) */
export async function fetchStoreConfig(slug: string): Promise<any | null> {
  return serverFetch(`${API_BASE_URL}/storefront/${slug}/config`);
}

/** Fetch store stories by slug — internal route (CMS content) */
export async function fetchStoreStories(slug: string): Promise<any[]> {
  const data = await serverFetch(`${API_BASE_URL}/storefront/${slug}/stories`);
  return data?.categories ?? [];
}

/** Fetch storefront index for sitemap — internal route */
export async function fetchSitemapProducts(): Promise<Array<{ slug: string; updatedAt: string }>> {
  const data = await serverFetch(`${API_BASE_URL}/storefront/index`);
  if (!data?.stores) return [];
  return data.stores.map((s: any) => ({
    slug: s.slug,
    updatedAt: s.updatedAt || new Date().toISOString(),
  }));
}
