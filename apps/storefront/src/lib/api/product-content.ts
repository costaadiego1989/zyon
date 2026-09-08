/**
 * Storefront public-content fetch layer.
 *
 * Wraps the flag-gated `GET /storefront/:slug/products/:productId/content`
 * endpoint. Returns `null` for any non-200 outcome — caller falls back to
 * the legacy `ProductCardBlock` surface.
 *
 * Notes:
 *  - Server-only fetch (Node runtime). NOT safe for client components.
 *  - Endpoint is gated by `@RequirePlanFeature("advancedProductLayout")` and
 *    `MerchantOwnershipGuard`, so non-flagged merchants receive 404 here.
 *  - Result shape mirrors `PublicProductContent` from
 *    `apps/api/src/modules/catalog/application/use-cases/get-product-content.use-case.ts`.
 */

import "server-only";

const API_BASE_URL =
  process.env.AACP_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3009";

export interface ProductContentBlockNode {
  id: string;
  productId: string;
  type: string;
  props: Record<string, unknown>;
  order: number;
  isEnabled: boolean;
}

export interface ProductFaqItemResponse {
  id: string;
  productId: string;
  question: string;
  answer: string;
  order: number;
  isPublished: boolean;
}

export interface ProductTestimonialResponse {
  id: string;
  productId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  body: string;
  rating?: number | null;
  source: "curated" | "customer_submission";
  moderationStatus: string;
  isPublished: boolean;
}

export interface ProductVideoResponse {
  id: string;
  productId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  source: "merchant" | "customer";
  moderationStatus: string;
  isPublished: boolean;
}

/** Minimal server-authoritative input required for a rich-content purchase CTA. */
export interface ProductContentPurchaseResponse {
  productName: string;
  description?: string | null;
  defaultVariantId: string | null;
  /** Public display amount in reais. The cart still recalculates from catalog. */
  priceReais?: number | null;
  currency?: string;
  variants: Array<{
    id: string;
    attributes: Record<string, string>;
    available: boolean;
    priceReais: number | null;
    currency: string;
    lowStock: boolean;
  }>;
  images: Array<{ src: string; alt: string; variantId: string }>;
  isDemo?: boolean;
  optionGroups: Array<{
    id: string;
    name: string;
    required: boolean;
    selectionType: "single" | "multiple";
    items: Array<{ id: string; name: string; priceModifierInCents: number }>;
  }>;
}

export interface PublicProductContent {
  merchantId?: string;
  productId: string;
  blocks: ProductContentBlockNode[];
  faqs: ProductFaqItemResponse[];
  testimonials: ProductTestimonialResponse[];
  videos: ProductVideoResponse[];
  purchase?: ProductContentPurchaseResponse;
}

/**
 * Server-side fetch of rich product content for a public storefront route.
 *
 * Returns `null` when:
 *  - the response is non-2xx (404 for missing store / product / flag-off merchants),
 *  - the body is not JSON,
 *  - the endpoint is unreachable.
 *
 * Callers MUST treat `null` as "fall back to legacy product card".
 */
export async function fetchProductContent(
  slug: string,
  productId: string,
): Promise<PublicProductContent | null> {
  if (!slug || !productId) return null;

  const url = `${API_BASE_URL}/storefront/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}/content`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      // Skip the HTTP cache — the read-side metrics recorder expects a live read
      // on each navigation; SSR can re-issue cheap calls.
      cache: "no-store",
    });

    if (!res.ok) return null;
    const body = (await res.json()) as Partial<PublicProductContent>;
    if (!body || typeof body !== "object" || !Array.isArray(body.blocks)) {
      return null;
    }

    return {
      merchantId: typeof body.merchantId === "string" ? body.merchantId : undefined,
      productId: typeof body.productId === "string" ? body.productId : productId,
      blocks: body.blocks ?? [],
      faqs: Array.isArray(body.faqs) ? body.faqs : [],
      testimonials: Array.isArray(body.testimonials) ? body.testimonials : [],
      videos: Array.isArray(body.videos) ? body.videos : [],
      purchase:
        body.purchase &&
        typeof body.purchase === "object" &&
        typeof (body.purchase as ProductContentPurchaseResponse).productName === "string" &&
        ((body.purchase as ProductContentPurchaseResponse).defaultVariantId === null || typeof (body.purchase as ProductContentPurchaseResponse).defaultVariantId === "string")
          ? {
              ...(body.purchase as ProductContentPurchaseResponse),
              images: Array.isArray(body.purchase.images) ? body.purchase.images : [],
              variants: Array.isArray((body.purchase as ProductContentPurchaseResponse).variants)
                ? (body.purchase as ProductContentPurchaseResponse).variants
                    .filter((variant) => variant && typeof variant.id === "string")
                : [],
              optionGroups: Array.isArray((body.purchase as ProductContentPurchaseResponse).optionGroups)
                ? (body.purchase as ProductContentPurchaseResponse).optionGroups
                : [],
            }
          : undefined,
    };
  } catch {
    // Network error, DNS failure, etc. Caller falls back to ProductCardBlock.
    return null;
  }
}
