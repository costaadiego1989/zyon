import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stores.zyon.com';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3009';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
  ];

  try {
    const res = await fetch(`${API_BASE_URL}/storefront/index`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = await res.json();
      for (const store of data.stores ?? []) {
        entries.push({
          url: `${BASE_URL}/store/${store.slug}`,
          lastModified: store.updatedAt ? new Date(store.updatedAt) : now,
          changeFrequency: 'daily',
          priority: 0.8,
        });
      }
    }
  } catch {
    // API unavailable — return minimal sitemap
  }

  return entries;
}
