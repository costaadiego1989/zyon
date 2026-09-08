import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

export interface ProductLayoutStatusEntry {
  productId: string;
  blockCount: number;
  enabledBlockCount: number;
  faqCount: number;
  testimonialCount: number;
  videoCount: number;
  lastUpdatedAt: string | null;
}

export interface ListProductLayoutStatusInput {
  merchantId: string;
}

export interface ListProductLayoutStatusResult {
  entries: ProductLayoutStatusEntry[];
  total: number;
}

/**
 * Aggregate, per-product layout status for the dashboard
 * "Conteúdo Avançado" list page.
 *
 * Returns one entry per active product owned by the merchant with
 * the count of content blocks (total + enabled), FAQs, testimonials,
 * and videos, plus the most recent `updatedAt` across the four
 * layout tables for that product.
 *
 * Tenant scope: every read is filtered by `product.merchantId`.
 * The dashboard reads this only for the merchant owning the session.
 */
@Injectable()
export class ListProductLayoutStatusUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: ListProductLayoutStatusInput): Promise<ListProductLayoutStatusResult> {
    const products = await this.prisma.product.findMany({
      where: { merchantId: input.merchantId, isActive: true },
      select: { id: true },
    });

    if (products.length === 0) {
      return { entries: [], total: 0 };
    }

    const productIds = products.map((p) => p.id);

    const [blockAgg, faqAgg, testimonialAgg, videoAgg] = await Promise.all([
      this.prisma.productContentBlock.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      this.prisma.productFaq.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _count: { _all: true },
      }),
      this.prisma.productTestimonial.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _count: { _all: true },
      }),
      this.prisma.productVideo.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _count: { _all: true },
      }),
    ]);

    // Enabled block counts need a second aggregation — groupBy can't
    // count with a conditional in one shot in current Prisma schema.
    const enabledBlockCounts = await this.prisma.productContentBlock.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, isEnabled: true },
      _count: { _all: true },
    });

    const blockByProduct = new Map(
      blockAgg.map((b) => [b.productId, { total: b._count._all, lastUpdatedAt: b._max.updatedAt }])
    );
    const enabledByProduct = new Map(
      enabledBlockCounts.map((b) => [b.productId, b._count._all])
    );
    const faqByProduct = new Map(faqAgg.map((b) => [b.productId, b._count._all]));
    const testimonialByProduct = new Map(testimonialAgg.map((b) => [b.productId, b._count._all]));
    const videoByProduct = new Map(videoAgg.map((b) => [b.productId, b._count._all]));

    const entries: ProductLayoutStatusEntry[] = productIds.map((productId) => {
      const block = blockByProduct.get(productId);
      return {
        productId,
        blockCount: block?.total ?? 0,
        enabledBlockCount: enabledByProduct.get(productId) ?? 0,
        faqCount: faqByProduct.get(productId) ?? 0,
        testimonialCount: testimonialByProduct.get(productId) ?? 0,
        videoCount: videoByProduct.get(productId) ?? 0,
        lastUpdatedAt: block?.lastUpdatedAt ? block.lastUpdatedAt.toISOString() : null,
      };
    });

    return { entries, total: entries.length };
  }
}
