import type { MetadataRoute } from 'next';
import { fetchSitemapProducts } from "@/lib/api/server-client";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stores.zyon.com';

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
    const items = await fetchSitemapProducts();
    for (const item of items) {
      entries.push({
        url: `${BASE_URL}/store/${item.slug}`,
        lastModified: item.updatedAt ? new Date(item.updatedAt) : now,
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
  } catch {
    // API unavailable — return minimal sitemap
  }

  return entries;
}
