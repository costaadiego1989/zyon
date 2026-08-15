'use client';

/**
 * JSON-LD structured data components for SEO.
 * Renders schema.org structured data for products and organizations.
 */

export function OrganizationSchema({
  name,
  logo,
  url,
  description,
  sameAs,
}: {
  name: string;
  logo?: string;
  url: string;
  description?: string;
  sameAs?: string[];
}) {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
    logo,
    description,
  };
  if (sameAs && sameAs.length > 0) {
    schema.sameAs = sameAs;
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function ProductSchema({
  name,
  price,
  currency,
  image,
  availability,
  description,
  url,
}: {
  name: string;
  price: number;
  currency: string;
  image?: string;
  availability: boolean;
  description?: string;
  url?: string;
}) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    url,
    offers: {
      '@type': 'Offer',
      price: (price / 100).toFixed(2),
      priceCurrency: currency,
      availability: availability
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function WebSiteSchema({
  name,
  url,
  searchUrlTemplate,
}: {
  name: string;
  url: string;
  searchUrlTemplate?: string;
}) {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url,
  };
  if (searchUrlTemplate) {
    schema.potentialAction = {
      '@type': 'SearchAction',
      target: searchUrlTemplate,
      'query-input': 'required name=search_term_string',
    };
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function BreadcrumbListSchema({ items }: { items: Array<{ name: string; url: string }> }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}