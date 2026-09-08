import { dashboardJson } from "../http/client.js";

/**
 * 12 block types from R1 of the Advanced Product Layout spec.
 * Mirrors `apps/storefront/src/components/blocks/ContentBlocks/types.ts`
 * for the rendered side. Editor and renderer share the same shape.
 */
export type ProductContentBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "image"
  | "image_text_split"
  | "callout"
  | "table"
  | "faq"
  | "video"
  | "carousel"
  | "banner"
  | "button";

export interface ProductContentBlock {
  id: string;
  productId: string;
  type: ProductContentBlockType;
  /** Per-type props; the editor treats it as Record<string, unknown>. */
  props: Record<string, unknown>;
  order: number;
  isEnabled: boolean;
}

export interface ProductFaq {
  id: string;
  productId: string;
  question: string;
  answer: string;
  order: number;
  isPublished: boolean;
}

export interface ProductTestimonial {
  id: string;
  productId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  body: string;
  rating?: number | null;
  source: "curated" | "customer_submission";
  buyerId?: string | null;
  orderId?: string | null;
  moderationStatus: "pending" | "approved" | "rejected";
  isPublished: boolean;
  order: number;
}

export interface ProductVideo {
  id: string;
  productId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  source: "merchant" | "customer";
  buyerId?: string | null;
  moderationStatus: "pending" | "approved" | "rejected";
  isPublished: boolean;
  order: number;
}

export interface ProductContentSurface {
  blocks: ProductContentBlock[];
  faqs: ProductFaq[];
  testimonials: ProductTestimonial[];
  videos: ProductVideo[];
}

export interface ReplaceBlocksPayload {
  blocks: Array<{
    id: string;
    type: ProductContentBlockType;
    props: Record<string, unknown>;
    order: number;
    isEnabled: boolean;
  }>;
}

export interface UpsertBlockPayload {
  id?: string;
  type: ProductContentBlockType;
  props: Record<string, unknown>;
  order: number;
  isEnabled: boolean;
}

export interface UpsertFaqPayload {
  id?: string;
  question: string;
  answer: string;
  order: number;
  isPublished: boolean;
}

export interface ReorderFaqPayload {
  orderedIds: string[];
}

export interface UpsertTestimonialPayload {
  id?: string;
  authorName: string;
  authorAvatarUrl?: string;
  body: string;
  rating?: number;
  order: number;
  isPublished: boolean;
  moderationStatus?: "pending" | "approved" | "rejected";
}

export interface UpsertVideoPayload {
  id?: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  order: number;
  isPublished: boolean;
  moderationStatus?: "pending" | "approved" | "rejected";
}

export function productContentEndpoints(base: string, f: typeof fetch) {
  return {
    // ── Content blocks ──────────────────────────────────────────────
    listContent(merchantId: string, productId: string): Promise<ProductContentSurface> {
      // GET per dashboard convention; falls back to POST in controller if the
      // platform routes everything through one verb. The hook handles 404
      // gracefully when the feature flag is off.
      return dashboardJson<ProductContentSurface>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/content`,
        { method: "GET" },
        f,
      );
    },
    replaceContentBlocks(
      merchantId: string,
      productId: string,
      payload: ReplaceBlocksPayload,
    ): Promise<{ blocks: ProductContentBlock[] }> {
      return dashboardJson<{ blocks: ProductContentBlock[] }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/content/blocks`,
        { method: "PUT", jsonBody: payload },
        f,
      );
    },
    upsertContentBlock(
      merchantId: string,
      productId: string,
      payload: UpsertBlockPayload,
    ): Promise<ProductContentBlock> {
      return dashboardJson<ProductContentBlock>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/content/blocks`,
        { method: "POST", jsonBody: payload },
        f,
      );
    },
    deleteContentBlock(
      merchantId: string,
      productId: string,
      blockId: string,
    ): Promise<{ deleted: boolean }> {
      return dashboardJson<{ deleted: boolean }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/content/blocks/${encodeURIComponent(blockId)}`,
        { method: "DELETE" },
        f,
      );
    },

    // ── FAQs ────────────────────────────────────────────────────────
    listFaqs(merchantId: string, productId: string): Promise<{ faqs: ProductFaq[] }> {
      return dashboardJson<{ faqs: ProductFaq[] }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/faqs`,
        { method: "POST" },
        f,
      );
    },
    upsertFaq(
      merchantId: string,
      productId: string,
      payload: UpsertFaqPayload,
    ): Promise<ProductFaq> {
      return dashboardJson<ProductFaq>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/faqs/create`,
        { method: "POST", jsonBody: payload },
        f,
      );
    },
    deleteFaq(merchantId: string, productId: string, faqId: string): Promise<{ deleted: boolean }> {
      return dashboardJson<{ deleted: boolean }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/faqs/${encodeURIComponent(faqId)}`,
        { method: "DELETE" },
        f,
      );
    },
    reorderFaqs(
      merchantId: string,
      productId: string,
      payload: ReorderFaqPayload,
    ): Promise<{ faqs: ProductFaq[] }> {
      return dashboardJson<{ faqs: ProductFaq[] }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/faqs/reorder`,
        { method: "PUT", jsonBody: payload },
        f,
      );
    },

    // ── Testimonials ───────────────────────────────────────────────
    listTestimonials(
      merchantId: string,
      productId: string,
    ): Promise<{ testimonials: ProductTestimonial[] }> {
      return dashboardJson<{ testimonials: ProductTestimonial[] }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/testimonials`,
        { method: "POST" },
        f,
      );
    },
    upsertTestimonial(
      merchantId: string,
      productId: string,
      payload: UpsertTestimonialPayload,
    ): Promise<ProductTestimonial> {
      return dashboardJson<ProductTestimonial>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/testimonials/create`,
        { method: "POST", jsonBody: payload },
        f,
      );
    },
    updateTestimonial(
      merchantId: string,
      productId: string,
      testimonialId: string,
      payload: Partial<UpsertTestimonialPayload>,
    ): Promise<ProductTestimonial> {
      return dashboardJson<ProductTestimonial>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/testimonials/${encodeURIComponent(testimonialId)}`,
        { method: "PUT", jsonBody: payload },
        f,
      );
    },
    moderateTestimonial(
      merchantId: string,
      productId: string,
      testimonialId: string,
      moderationStatus: "approved" | "rejected",
      isPublished: boolean,
    ): Promise<ProductTestimonial> {
      return dashboardJson<ProductTestimonial>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/testimonials/${encodeURIComponent(testimonialId)}/moderate`,
        { method: "POST", jsonBody: { moderationStatus, isPublished } },
        f,
      );
    },
    deleteTestimonial(
      merchantId: string,
      productId: string,
      testimonialId: string,
    ): Promise<{ deleted: boolean }> {
      return dashboardJson<{ deleted: boolean }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/testimonials/${encodeURIComponent(testimonialId)}`,
        { method: "DELETE" },
        f,
      );
    },

    // ── Videos ──────────────────────────────────────────────────────
    listVideos(merchantId: string, productId: string): Promise<{ videos: ProductVideo[] }> {
      return dashboardJson<{ videos: ProductVideo[] }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/videos`,
        { method: "POST" },
        f,
      );
    },
    upsertVideo(
      merchantId: string,
      productId: string,
      payload: UpsertVideoPayload,
    ): Promise<ProductVideo> {
      return dashboardJson<ProductVideo>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/videos/create`,
        { method: "POST", jsonBody: payload },
        f,
      );
    },
    updateVideo(
      merchantId: string,
      productId: string,
      videoId: string,
      payload: Partial<UpsertVideoPayload>,
    ): Promise<ProductVideo> {
      return dashboardJson<ProductVideo>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}`,
        { method: "PUT", jsonBody: payload },
        f,
      );
    },
    moderateVideo(
      merchantId: string,
      productId: string,
      videoId: string,
      moderationStatus: "approved" | "rejected",
      isPublished: boolean,
    ): Promise<ProductVideo> {
      return dashboardJson<ProductVideo>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}/moderate`,
        { method: "POST", jsonBody: { moderationStatus, isPublished } },
        f,
      );
    },
    deleteVideo(
      merchantId: string,
      productId: string,
      videoId: string,
    ): Promise<{ deleted: boolean }> {
      return dashboardJson<{ deleted: boolean }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}`,
        { method: "DELETE" },
        f,
      );
    },

    // ── Content media uploads (S3) ────────────────────────────────
    uploadContentImage(
      merchantId: string,
      productId: string,
      imageBase64: string,
    ): Promise<{ url: string }> {
      return dashboardJson<{ url: string }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/content/upload`,
        { method: "POST", jsonBody: { image: imageBase64 } },
        f,
      );
    },
  };
}
