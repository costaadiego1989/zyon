import { Inject, Injectable } from "@nestjs/common";
import {
  PRODUCT_CONTENT_REPOSITORY,
  ProductContentRepositoryPort,
} from "../../domain/ports/product-content-repository.port.js";
import {
  PRODUCT_FAQ_REPOSITORY,
  ProductFaqRepositoryPort,
} from "../../domain/ports/product-faq-repository.port.js";
import {
  PRODUCT_TESTIMONIAL_REPOSITORY,
  ProductTestimonialRepositoryPort,
} from "../../domain/ports/product-testimonial-repository.port.js";
import {
  PRODUCT_VIDEO_REPOSITORY,
  ProductVideoRepositoryPort,
} from "../../domain/ports/product-video-repository.port.js";

export type PublicProductContent = {
  blocks: Array<{
    id: string;
    productId: string;
    type: string;
    props: Record<string, unknown>;
    order: number;
    isEnabled: boolean;
  }>;
  faqs: Array<{
    id: string;
    productId: string;
    question: string;
    answer: string;
    order: number;
    isPublished: boolean;
  }>;
  testimonials: Array<{
    id: string;
    productId: string;
    authorName: string;
    authorAvatarUrl?: string | null;
    body: string;
    rating?: number | null;
    source: "curated" | "customer_submission";
    moderationStatus: string;
    isPublished: boolean;
  }>;
  videos: Array<{
    id: string;
    productId: string;
    title: string;
    videoUrl: string;
    thumbnailUrl?: string | null;
    durationSeconds?: number | null;
    source: "merchant" | "customer";
    moderationStatus: string;
    isPublished: boolean;
  }>;
};

/**
 * Read the public-safe product content surface for a given product.
 * Filters to:
 *   - blocks where isEnabled=true
 *   - FAQs where isPublished=true
 *   - testimonials where isPublished=true AND moderationStatus='approved'
 *   - videos where isPublished=true AND moderationStatus='approved'
 *
 * Use-case enforces merchant scoping via productId → product.merchantId lookup
 * (delegated to each repository's findBy* method).
 */
@Injectable()
export class GetProductContentUseCase {
  constructor(
    @Inject(PRODUCT_CONTENT_REPOSITORY)
    private readonly contentRepo: ProductContentRepositoryPort,
    @Inject(PRODUCT_FAQ_REPOSITORY) private readonly faqRepo: ProductFaqRepositoryPort,
    @Inject(PRODUCT_TESTIMONIAL_REPOSITORY)
    private readonly testimonialRepo: ProductTestimonialRepositoryPort,
    @Inject(PRODUCT_VIDEO_REPOSITORY) private readonly videoRepo: ProductVideoRepositoryPort,
  ) {}

  async execute(input: { merchantId: string; productId: string }): Promise<PublicProductContent> {
    const [blocks, faqs, testimonials, videos] = await Promise.all([
      this.contentRepo.findByProduct(input),
      this.faqRepo.findPublishedByProduct({ productId: input.productId }),
      this.testimonialRepo.findApprovedByProduct({ productId: input.productId }),
      this.videoRepo.findApprovedByProduct({ productId: input.productId }),
    ]);

    return {
      blocks: blocks
        .filter((b) => b.isEnabled)
        .map((b) => ({
          id: b.id,
          productId: b.productId,
          type: b.type,
          props: b.props,
          order: b.order,
          isEnabled: b.isEnabled,
        })),
      faqs: faqs.map((f) => ({
        id: f.id,
        productId: f.productId,
        question: f.question,
        answer: f.answer,
        order: f.order,
        isPublished: f.isPublished,
      })),
      testimonials: testimonials.map((t) => ({
        id: t.id,
        productId: t.productId,
        authorName: t.authorName,
        authorAvatarUrl: t.authorAvatarUrl,
        body: t.body,
        rating: t.rating,
        source: t.source,
        moderationStatus: t.moderationStatus,
        isPublished: t.isPublished,
      })),
      videos: videos.map((v) => ({
        id: v.id,
        productId: v.productId,
        title: v.title,
        videoUrl: v.videoUrl,
        thumbnailUrl: v.thumbnailUrl,
        durationSeconds: v.durationSeconds,
        source: v.source,
        moderationStatus: v.moderationStatus,
        isPublished: v.isPublished,
      })),
    };
  }
}
