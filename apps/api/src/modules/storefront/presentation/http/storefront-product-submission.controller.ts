import {
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { OptionalBuyerJwtAuthGuard } from "../../../buyer-account/presentation/http/optional-buyer-jwt-auth.guard.js";
import type { BuyerPrincipal } from "../../../buyer-account/domain/services/buyer-jwt.service.js";
import { RateLimit } from "../../../../shared/rate-limit/rate-limit.decorators.js";
import { SubmitCustomerTestimonialUseCase } from "../../../catalog/application/use-cases/submit-customer-testimonial.use-case.js";
import { SubmitCustomerVideoUseCase } from "../../../catalog/application/use-cases/submit-customer-video.use-case.js";

/**
 * Wave 3 — Public storefront submission endpoints (R3 + R4 of the Advanced
 * Product Layout spec). Buyers can submit a testimonial or video URL against
 * a product from the storefront without first creating an account; the row
 * is parked with `moderationStatus='pending'` until a merchant approves or
 * rejects it.
 *
 * Tenant boundary: the slug resolves to a merchant; the product MUST belong
 * to that merchant AND be `isActive=true AND deletedAt=null`. Mismatch →
 * 404 (no cross-tenant existence leak).
 *
 * Auth: optional via `OptionalBuyerJwtAuthGuard`. When a Bearer JWT is
 * present + valid, `globalUserId` is captured as `buyerId` so the moderation
 * queue and a future "your submissions" UI can scope by buyer. No token or
 * invalid token → submission still succeeds as anonymous.
 *
 * Rate-limit: 1 submission per IP per 5 minutes via `@RateLimit` (the global
 * `RateLimitGuard` is registered as APP_GUARD in
 * apps/api/src/shared/http/http.module.ts). The override makes the bucket
 * per-route so each endpoint has its own 5-minute counter.
 *
 * URL safety: `assertSafeUrl` is invoked inside the use-case BEFORE
 * persistence so javascript:/data:/vbscript: payloads fail fast and never
 * reach the DB.
 */
@Controller("storefront")
export class StorefrontProductSubmissionController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly submitTestimonialUseCase: SubmitCustomerTestimonialUseCase,
    private readonly submitVideoUseCase: SubmitCustomerVideoUseCase,
  ) {}

  @UseGuards(OptionalBuyerJwtAuthGuard)
  @RateLimit(1, 5 * 60 * 1000)
  @Post(":slug/products/:productId/testimonials")
  async submitTestimonial(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
    @Body() body: {
      authorName?: string;
      body?: string;
      rating?: number | null;
      buyerEmail?: string;
      buyerPhone?: string;
      authorAvatarUrl?: string;
    },
    @Req() req: Request,
  ) {
    const { merchantId } = await this.resolveMerchantAndProduct(slug, productId);
    const buyer = (req as Request & { user?: BuyerPrincipal }).user;

    const created = await this.submitTestimonialUseCase.execute({
      merchantId,
      productId,
      authorName: body.authorName ?? "",
      body: body.body ?? "",
      rating: body.rating ?? null,
      authorAvatarUrl: body.authorAvatarUrl ?? null,
      buyerId: buyer?.globalUserId ?? null,
    });

    return {
      id: created.id,
      productId: created.productId,
      moderationStatus: created.moderationStatus,
      isPublished: created.isPublished,
    };
  }

  @UseGuards(OptionalBuyerJwtAuthGuard)
  @RateLimit(1, 5 * 60 * 1000)
  @Post(":slug/products/:productId/videos")
  async submitVideo(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
    @Body() body: {
      title?: string;
      videoUrl?: string;
      thumbnailUrl?: string;
      buyerEmail?: string;
    },
    @Req() req: Request,
  ) {
    const { merchantId } = await this.resolveMerchantAndProduct(slug, productId);
    const buyer = (req as Request & { user?: BuyerPrincipal }).user;

    const created = await this.submitVideoUseCase.execute({
      merchantId,
      productId,
      title: body.title ?? "",
      videoUrl: body.videoUrl ?? "",
      thumbnailUrl: body.thumbnailUrl ?? null,
      buyerId: buyer?.globalUserId ?? null,
    });

    return {
      id: created.id,
      productId: created.productId,
      moderationStatus: created.moderationStatus,
      isPublished: created.isPublished,
    };
  }

  /**
   * Resolve `slug → merchantId` and verify the product belongs to that
   * merchant AND is active + not soft-deleted. Returns 404 on any mismatch
   * so cross-tenant existence is not leaked.
   */
  private async resolveMerchantAndProduct(
    slug: string,
    productId: string
  ): Promise<{ merchantId: string }> {
    const merchant = await this.prisma.merchant.findFirst({
      where: { storeSlug: slug },
      select: { id: true, storeSlug: true },
    });
    if (!merchant || !merchant.storeSlug) {
      throw new NotFoundException({ code: "store_not_found" });
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        merchantId: merchant.id,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, merchantId: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }

    return { merchantId: product.merchantId };
  }
}
