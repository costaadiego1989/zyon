import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import {
  PRODUCT_TESTIMONIAL_REPOSITORY,
  type ProductTestimonialRepositoryPort,
} from "../../domain/ports/product-testimonial-repository.port.js";
import {
  PRODUCT_VIDEO_REPOSITORY,
  type ProductVideoRepositoryPort,
} from "../../domain/ports/product-video-repository.port.js";
import { ModerateProductTestimonialUseCase } from "../../application/use-cases/moderate-product-testimonial.use-case.js";
import { ModerateProductVideoUseCase } from "../../application/use-cases/moderate-product-video.use-case.js";
import {
  ListMerchantProductReviewsUseCase,
  type MerchantProductReviewKind,
  type MerchantProductReviewStatus,
} from "../../application/use-cases/list-merchant-product-reviews.use-case.js";

/**
 * Wave 3 — Merchant moderation endpoints (R3 + R4 of the Advanced Product
 * Layout spec). Wraps the Wave 2 `ModerateProduct*UseCase` ports over HTTP
 * so the dashboard moderation queue UI can:
 *   - List pending testimonials + videos
 *   - Approve or reject either (one shot per call)
 *
 * Tenant boundary: routes carry `:mid` and go through `MerchantOwnershipGuard`
 * so a merchant can never approve someone else's row. The repo's
 * `approve`/`reject` also enforce merchant scope via the Prisma where
 * `product: { merchantId: input.merchantId }` filter.
 *
 * Plan gate: `@RequirePlanFeature("advancedProductLayout")` returns 404 when
 * the merchant is not entitled, so a downgrade doesn't leak the queue shape.
 */
@Controller("merchants")
export class ModerationController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PRODUCT_TESTIMONIAL_REPOSITORY)
    private readonly testimonialRepo: ProductTestimonialRepositoryPort,
    @Inject(PRODUCT_VIDEO_REPOSITORY)
    private readonly videoRepo: ProductVideoRepositoryPort,
    private readonly moderateTestimonial: ModerateProductTestimonialUseCase,
    private readonly moderateVideo: ModerateProductVideoUseCase,
    private readonly listMerchantReviews: ListMerchantProductReviewsUseCase,
  ) {}

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Get(":mid/reviews")
  async listMerchantReviewsRoute(
    @Param("mid") merchantId: string,
    @Query() query: {
      kind?: string;
      moderationStatus?: string;
      productId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const kind = parseReviewKind(query.kind);
    const moderationStatus = parseReviewStatus(query.moderationStatus);
    const createdFrom = parseReviewDate(query.dateFrom, false);
    const createdTo = parseReviewDate(query.dateTo, true);
    if (createdFrom && createdTo && createdFrom > createdTo) {
      throw new BadRequestException({ code: "invalid_review_date_range" });
    }

    return this.listMerchantReviews.execute({
      merchantId,
      kind,
      moderationStatus,
      productId: textOrUndefined(query.productId),
      createdFrom,
      createdTo,
      page: parsePositiveQueryInteger(query.page),
      pageSize: parsePositiveQueryInteger(query.pageSize),
    });
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/moderation/pending")
  async listPending(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string
  ) {
    // Verify the product belongs to this merchant — return 404 otherwise to
    // avoid leaking existence across tenants.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }

    const [pendingTestimonials, pendingVideos] = await Promise.all([
      this.testimonialRepo.listAllForMerchant({
        merchantId,
        productId,
        moderationStatus: "pending",
      }),
      this.videoRepo.listAllForMerchant({
        merchantId,
        productId,
        moderationStatus: "pending",
      }),
    ]);

    return {
      pendingTestimonials: pendingTestimonials.map((t) => ({
        id: t.id,
        productId: t.productId,
        authorName: t.authorName,
        authorAvatarUrl: t.authorAvatarUrl,
        body: t.body,
        rating: t.rating,
        source: t.source,
        buyerId: t.buyerId,
        moderationStatus: t.moderationStatus,
        createdAt: t.createdAt,
      })),
      pendingVideos: pendingVideos.map((v) => ({
        id: v.id,
        productId: v.productId,
        title: v.title,
        videoUrl: v.videoUrl,
        thumbnailUrl: v.thumbnailUrl,
        durationSeconds: v.durationSeconds,
        source: v.source,
        buyerId: v.buyerId,
        moderationStatus: v.moderationStatus,
        createdAt: v.createdAt,
      })),
    };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/testimonials/:tid/moderate")
  async moderateTestimonialRoute(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Param("tid") testimonialId: string,
    @Body() body: { moderationStatus?: string; isPublished?: boolean },
    @Req() req: Request
  ) {
    const status = body.moderationStatus;
    if (status !== "approved" && status !== "rejected") {
      throw new BadRequestException({
        code: "invalid_moderation_status",
        message: "moderationStatus must be 'approved' or 'rejected'",
      });
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }
    const testimonial = (await this.testimonialRepo.listAllForMerchant({ merchantId, productId }))
      .find((item) => item.id === testimonialId);
    if (!testimonial) {
      throw new NotFoundException({ code: "testimonial_not_found" });
    }
    // Actor identity comes from AuthGuard → request.user (merchant principal).
    // The repo's approve/reject also enforce merchant scope via the product
    // join, so a forged :tid in a different tenant returns a Prisma
    // RecordNotFound that we surface as 404 above.
    const principal = (req as Request & { user?: { userId?: string } }).user;
    const actor = {
      id: principal?.userId ?? "system",
      merchantId,
    };
    if (typeof body.isPublished === "boolean") {
      await this.testimonialRepo.update({
        merchantId,
        id: testimonialId,
        patch: { isPublished: body.isPublished },
      });
    }
    if (status === "approved") {
      return this.moderateTestimonial.approve({
        merchantId,
        id: testimonialId,
        actor,
      });
    }
    return this.moderateTestimonial.reject({
      merchantId,
      id: testimonialId,
      actor,
    });
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/videos/:vid/moderate")
  async moderateVideoRoute(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Param("vid") videoId: string,
    @Body() body: { moderationStatus?: string; isPublished?: boolean },
    @Req() req: Request
  ) {
    const status = body.moderationStatus;
    if (status !== "approved" && status !== "rejected") {
      throw new BadRequestException({
        code: "invalid_moderation_status",
        message: "moderationStatus must be 'approved' or 'rejected'",
      });
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }
    const video = (await this.videoRepo.listAllForMerchant({ merchantId, productId }))
      .find((item) => item.id === videoId);
    if (!video) {
      throw new NotFoundException({ code: "video_not_found" });
    }
    const principal = (req as Request & { user?: { userId?: string } }).user;
    const actor = {
      id: principal?.userId ?? "system",
      merchantId,
    };
    if (typeof body.isPublished === "boolean") {
      await this.videoRepo.update({
        merchantId,
        id: videoId,
        patch: { isPublished: body.isPublished },
      });
    }
    if (status === "approved") {
      return this.moderateVideo.approve({
        merchantId,
        id: videoId,
        actor,
      });
    }
    return this.moderateVideo.reject({
      merchantId,
      id: videoId,
      actor,
    });
  }
}

function parseReviewKind(value: string | undefined): MerchantProductReviewKind {
  if (value === undefined || value === "testimonial") return "testimonial";
  if (value === "video") return "video";
  throw new BadRequestException({ code: "invalid_review_kind" });
}

function parseReviewStatus(value: string | undefined): MerchantProductReviewStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "pending" || value === "approved" || value === "rejected") return value;
  throw new BadRequestException({ code: "invalid_review_moderation_status" });
}

function parseReviewDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({ code: "invalid_review_date" });
  }
  return parsed;
}

function parsePositiveQueryInteger(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new BadRequestException({ code: "invalid_review_pagination" });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException({ code: "invalid_review_pagination" });
  }
  return parsed;
}

function textOrUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
