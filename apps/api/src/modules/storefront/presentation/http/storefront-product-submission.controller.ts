import {
  BadRequestException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { BuyerJwtAuthGuard } from "../../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import type { BuyerPrincipal } from "../../../buyer-account/domain/services/buyer-jwt.service.js";
import { RateLimit } from "../../../../shared/rate-limit/rate-limit.decorators.js";
import { SubmitCustomerTestimonialUseCase } from "../../../catalog/application/use-cases/submit-customer-testimonial.use-case.js";
import { SubmitCustomerVideoUseCase } from "../../../catalog/application/use-cases/submit-customer-video.use-case.js";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";

const MAX_CUSTOMER_VIDEO_BYTES = 50 * 1024 * 1024;
const CUSTOMER_VIDEO_CONTENT_TYPE = "video/mp4";

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
    private readonly s3: S3UploadService,
  ) {}

  @UseGuards(BuyerJwtAuthGuard)
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
    if (!buyer) throw new BadRequestException({ code: "missing_authenticated_buyer" });

    const created = await this.submitTestimonialUseCase.execute({
      merchantId,
      productId,
      authorName: body.authorName ?? "",
      body: body.body ?? "",
      rating: body.rating ?? null,
      authorAvatarUrl: body.authorAvatarUrl ?? null,
      buyerId: buyer.globalUserId,
    });

    return {
      id: created.id,
      productId: created.productId,
      moderationStatus: created.moderationStatus,
      isPublished: created.isPublished,
    };
  }

  @UseGuards(BuyerJwtAuthGuard)
  @RateLimit(3, 5 * 60 * 1000)
  @Post(":slug/products/:productId/videos/upload-url")
  async createVideoUploadUrl(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
    @Body() body: { contentType?: unknown; sizeBytes?: unknown },
    @Req() req: Request,
  ) {
    if (body.contentType !== CUSTOMER_VIDEO_CONTENT_TYPE) {
      throw new BadRequestException({
        code: "unsupported_customer_video_type",
        message: "Only MP4 video uploads are supported.",
      });
    }
    if (
      typeof body.sizeBytes !== "number" ||
      !Number.isSafeInteger(body.sizeBytes) ||
      body.sizeBytes < 1 ||
      body.sizeBytes > MAX_CUSTOMER_VIDEO_BYTES
    ) {
      throw new BadRequestException({
        code: "invalid_customer_video_size",
        message: `Video uploads must be between 1 byte and ${MAX_CUSTOMER_VIDEO_BYTES} bytes.`,
      });
    }

    const { merchantId } = await this.resolveMerchantAndProduct(slug, productId);
    const buyer = (req as Request & { user?: BuyerPrincipal }).user;
    if (!buyer) throw new BadRequestException({ code: "missing_authenticated_buyer" });
    if (!this.s3.isConfigured()) {
      throw new ServiceUnavailableException({
        code: "customer_video_upload_unavailable",
        message: "O envio de videos esta temporariamente indisponivel.",
      });
    }

    const upload = await this.s3.createPresignedPostUpload({
      contentType: CUSTOMER_VIDEO_CONTENT_TYPE,
      folder: this.customerVideoFolder(merchantId, productId, buyer.globalUserId),
      expiresInSeconds: 300,
      maxContentLength: MAX_CUSTOMER_VIDEO_BYTES,
    });

    return {
      uploadUrl: upload.uploadUrl,
      uploadFields: upload.uploadFields,
      videoUrl: upload.url,
      expiresAt: upload.expiresAt,
      contentType: CUSTOMER_VIDEO_CONTENT_TYPE,
      maxBytes: MAX_CUSTOMER_VIDEO_BYTES,
    };
  }

  @UseGuards(BuyerJwtAuthGuard)
  @RateLimit(1, 5 * 60 * 1000)
  @Post(":slug/products/:productId/videos")
  async submitVideo(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
    @Body() body: {
      title?: string;
      videoUrl?: string;
    },
    @Req() req: Request,
  ) {
    const { merchantId } = await this.resolveMerchantAndProduct(slug, productId);
    const buyer = (req as Request & { user?: BuyerPrincipal }).user;
    if (!buyer) throw new BadRequestException({ code: "missing_authenticated_buyer" });

    const folder = this.customerVideoFolder(merchantId, productId, buyer.globalUserId);
    if (!body.videoUrl || !this.s3.isObjectUrlWithinFolder(body.videoUrl, folder)) {
      throw new BadRequestException({
        code: "customer_video_upload_required",
        message: "Upload the video through the review form before submitting it.",
      });
    }

    const created = await this.submitVideoUseCase.execute({
      merchantId,
      productId,
      title: body.title ?? "",
      videoUrl: body.videoUrl ?? "",
      thumbnailUrl: null,
      buyerId: buyer.globalUserId,
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

  private customerVideoFolder(merchantId: string, productId: string, buyerId: string): string {
    return `merchants/${merchantId}/products/${productId}/customer-reviews/${buyerId}`;
  }
}
