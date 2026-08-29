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
export async function fetchStoreConfig(slug: string): Promise<any | null> {
  return serverFetch(`${API_BASE_URL}/storefront/${slug}/config`);
}
export async function fetchStoreStories(slug: string): Promise<any[]> {
  const data = await serverFetch(`${API_BASE_URL}/storefront/${slug}/stories`);
  return data?.categories ?? [];
}
export async function fetchSitemapProducts(): Promise<Array<{ slug: string; updatedAt: string }>> {
  const data = await serverFetch(`${API_BASE_URL}/storefront/index`);
  if (!data?.stores) return [];
  return data.stores.map((s: any) => ({
    slug: s.slug,
    updatedAt: s.updatedAt || new Date().toISOString(),
  }));
}
