import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { PublishProductContentUseCase } from "../../application/use-cases/publish-product-content.use-case.js";
import { RevertProductContentUseCase } from "../../application/use-cases/revert-product-content.use-case.js";
import {
  PRODUCT_CONTENT_REPOSITORY,
  type ProductContentRepositoryPort,
} from "../../domain/ports/product-content-repository.port.js";
import {
  PRODUCT_FAQ_REPOSITORY,
  type ProductFaqRepositoryPort,
} from "../../domain/ports/product-faq-repository.port.js";
import {
  PRODUCT_TESTIMONIAL_REPOSITORY,
  type ProductTestimonialRepositoryPort,
} from "../../domain/ports/product-testimonial-repository.port.js";
import {
  PRODUCT_VIDEO_REPOSITORY,
  type ProductVideoRepositoryPort,
} from "../../domain/ports/product-video-repository.port.js";
import {
  DEFAULT_PRODUCT_CONTENT_LOCALE,
  type ProductContentBlockProps,
} from "../../domain/entities/product-content-block.entity.js";
import { assertSafeUrl, validateBlock } from "../../domain/services/product-content-validator.service.js";

/**
 * Wave 3 history controller: list past content versions per (product, locale)
 * and revert the live surface back to a selected snapshot.
 *
 * Tenant boundary: every route is `/merchants/:mid/...` and goes through
 * `MerchantOwnershipGuard` so a merchant can only see their own history.
 *
 * Plan gate: `@RequirePlanFeature("advancedProductLayout")` returns 404 when
 * the merchant isn't entitled — downgrade does not leak the history shape.
 */
@Controller("merchants")
export class ProductContentHistoryController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly listVersionsUseCase: RevertProductContentUseCase,
  ) {}

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/content/history")
  async listHistory(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { locale?: string; limit?: number },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }
    const versions = await this.listVersionsUseCase.listVersions({
      merchantId,
      productId,
      ...(body.locale ? { locale: body.locale } : {}),
      ...(body.limit ? { limit: body.limit } : {}),
    });
    return {
      productId,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        savedBy: v.savedBy,
        savedAt: v.savedAt,
        restoredFromVersion: v.restoredFromVersion,
      })),
    };
  }
}

/**
 * Standalone controller surface for product content publish/revert
 * operations that don't fit under the moderation queue. Reuses the same
 * guards + plan gate as the history endpoint so merchant UI can wire to
 * a single controller for the dashboard side.
 */
@Controller("merchants")
export class ProductContentController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly publishContent: PublishProductContentUseCase,
    private readonly revertContent: RevertProductContentUseCase,
    private readonly s3: S3UploadService,
    @Inject(PRODUCT_CONTENT_REPOSITORY)
    private readonly contentRepo: ProductContentRepositoryPort,
    @Inject(PRODUCT_FAQ_REPOSITORY)
    private readonly faqRepo: ProductFaqRepositoryPort,
    @Inject(PRODUCT_TESTIMONIAL_REPOSITORY)
    private readonly testimonialRepo: ProductTestimonialRepositoryPort,
    @Inject(PRODUCT_VIDEO_REPOSITORY)
    private readonly videoRepo: ProductVideoRepositoryPort,
  ) {}

  /** Dashboard read: includes drafts and moderation states. Public storefront
   * reads deliberately use the separate storefront controller, which filters
   * this same data to published buyer-safe records. */
  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Get(":mid/products/:pid/content")
  async getContent(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
  ) {
    await this.assertProduct(merchantId, productId);
    const [blocks, faqs, testimonials, videos] = await Promise.all([
      this.contentRepo.findByProduct({ merchantId, productId, locale: DEFAULT_PRODUCT_CONTENT_LOCALE }),
      this.faqRepo.listAllForMerchant({ merchantId, productId, locale: DEFAULT_PRODUCT_CONTENT_LOCALE }),
      this.testimonialRepo.listAllForMerchant({ merchantId, productId, locale: DEFAULT_PRODUCT_CONTENT_LOCALE }),
      this.videoRepo.listAllForMerchant({ merchantId, productId, locale: DEFAULT_PRODUCT_CONTENT_LOCALE }),
    ]);
    return {
      blocks: blocks.map((block) => this.serializeBlock(block)),
      faqs: faqs.map((faq) => this.serializeFaq(faq)),
      testimonials: testimonials.map((testimonial) => this.serializeTestimonial(testimonial)),
      videos: videos.map((video) => this.serializeVideo(video)),
    };
  }

  /** Atomic, full-document save used by the dashboard block editor. */
  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Put(":mid/products/:pid/content/blocks")
  async replaceBlocks(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { blocks?: Array<{ id?: unknown; type?: unknown; props?: unknown; order?: unknown; isEnabled?: unknown }>; locale?: unknown },
    @Req() req: Request,
  ) {
    await this.assertProduct(merchantId, productId);
    if (!Array.isArray(body?.blocks)) {
      throw new BadRequestException({ code: "product_content_blocks_required" });
    }
    if (body.blocks.length > 200) {
      throw new BadRequestException({ code: "product_content_blocks_limit_exceeded" });
    }

    const ids = new Set<string>();
    const normalized = body.blocks.map((raw, index) => {
      if (!raw || typeof raw.id !== "string" || raw.id.trim().length === 0) {
        throw new BadRequestException({ code: "product_content_block_id_required", index });
      }
      if (ids.has(raw.id)) {
        throw new BadRequestException({ code: "product_content_block_id_duplicate", index });
      }
      ids.add(raw.id);
      const validated = validateBlock({ type: raw.type, props: raw.props });
      const order = typeof raw.order === "number" && Number.isInteger(raw.order) && raw.order >= 0
        ? raw.order
        : index;
      return { id: raw.id, ...validated, order, isEnabled: raw.isEnabled !== false };
    }).sort((a, b) => a.order - b.order);

    const now = new Date();
    const blocks: ProductContentBlockProps[] = normalized.map((block, order) => ({
      id: block.id,
      productId,
      type: block.type,
      props: block.props,
      order,
      isEnabled: block.isEnabled,
      locale: DEFAULT_PRODUCT_CONTENT_LOCALE,
      createdAt: now,
      updatedAt: now,
    }));
    const saved = await this.publishContent.execute({
      merchantId,
      productId,
      blocks,
      source: "bulk_replace",
    });
    return { blocks: saved.map((block) => this.serializeBlock(block)) };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/faqs")
  async listFaqs(@Param("mid") merchantId: string, @Param("pid") productId: string) {
    await this.assertProduct(merchantId, productId);
    return { faqs: (await this.faqRepo.listAllForMerchant({ merchantId, productId })).map((faq) => this.serializeFaq(faq)) };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/faqs/create")
  async upsertFaq(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { id?: unknown; question?: unknown; answer?: unknown; order?: unknown; isPublished?: unknown },
    @Req() req: Request,
  ) {
    await this.assertProduct(merchantId, productId);
    const question = this.requiredText(body.question, "product_faq_question_required", 500);
    const answer = this.requiredText(body.answer, "product_faq_answer_required", 4000);
    const order = this.nonNegativeInteger(body.order, 0);
    const actor = this.actor(req, merchantId);
    if (typeof body.id === "string" && body.id) {
      await this.assertResourceBelongsToProduct(this.faqRepo.listAllForMerchant({ merchantId, productId }), body.id);
      return this.serializeFaq(await this.faqRepo.update({ merchantId, id: body.id, patch: { question, answer, order, isPublished: body.isPublished === true } }));
    }
    return this.serializeFaq(await this.faqRepo.create({ merchantId, productId, question, answer, order, isPublished: body.isPublished === true }, actor));
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Put(":mid/products/:pid/faqs/reorder")
  async reorderFaqs(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { orderedIds?: unknown },
  ) {
    await this.assertProduct(merchantId, productId);
    if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== "string")) {
      throw new BadRequestException({ code: "product_faq_ordered_ids_invalid" });
    }
    const existing = await this.faqRepo.listAllForMerchant({ merchantId, productId });
    if (body.orderedIds.length !== existing.length || new Set(body.orderedIds).size !== existing.length || body.orderedIds.some((id) => !existing.some((faq) => faq.id === id))) {
      throw new BadRequestException({ code: "product_faq_ordered_ids_mismatch" });
    }
    const faqs = await this.faqRepo.reorder({ merchantId, productId, orderedIds: body.orderedIds });
    return { faqs: faqs.map((faq) => this.serializeFaq(faq)) };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Delete(":mid/products/:pid/faqs/:fid")
  async deleteFaq(@Param("mid") merchantId: string, @Param("pid") productId: string, @Param("fid") id: string) {
    await this.assertProduct(merchantId, productId);
    await this.assertResourceBelongsToProduct(this.faqRepo.listAllForMerchant({ merchantId, productId }), id);
    await this.faqRepo.delete({ merchantId, id });
    return { deleted: true };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/testimonials")
  async listTestimonials(@Param("mid") merchantId: string, @Param("pid") productId: string) {
    await this.assertProduct(merchantId, productId);
    return { testimonials: (await this.testimonialRepo.listAllForMerchant({ merchantId, productId })).map((testimonial) => this.serializeTestimonial(testimonial)) };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/testimonials/create")
  async upsertTestimonial(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { id?: unknown; authorName?: unknown; authorAvatarUrl?: unknown; body?: unknown; rating?: unknown; isPublished?: unknown; moderationStatus?: unknown },
    @Req() req: Request,
  ) {
    await this.assertProduct(merchantId, productId);
    const authorName = this.requiredText(body.authorName, "product_testimonial_author_required", 280);
    const testimonialBody = this.requiredText(body.body, "product_testimonial_body_required", 4000);
    const rating = this.rating(body.rating);
    const avatar = this.optionalUrl(body.authorAvatarUrl);
    const moderationStatus = this.moderationStatus(body.moderationStatus, "approved");
    const isPublished = body.isPublished === true;
    const actor = this.actor(req, merchantId);
    if (typeof body.id === "string" && body.id) {
      await this.assertResourceBelongsToProduct(this.testimonialRepo.listAllForMerchant({ merchantId, productId }), body.id);
      return this.serializeTestimonial(await this.testimonialRepo.update({
        merchantId,
        id: body.id,
        patch: { authorName, authorAvatarUrl: avatar, body: testimonialBody, rating, isPublished, moderationStatus },
      }));
    }
    return this.serializeTestimonial(await this.testimonialRepo.create({
      merchantId, productId, authorName, authorAvatarUrl: avatar, body: testimonialBody, rating,
      source: "curated", moderationStatus, isPublished,
    }, actor));
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Put(":mid/products/:pid/testimonials/:tid")
  async updateTestimonial(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Param("tid") id: string,
    @Body() body: { authorName?: unknown; authorAvatarUrl?: unknown; body?: unknown; rating?: unknown; isPublished?: unknown; moderationStatus?: unknown },
  ) {
    await this.assertProduct(merchantId, productId);
    await this.assertResourceBelongsToProduct(this.testimonialRepo.listAllForMerchant({ merchantId, productId }), id);
    const patch = {
      ...(body.authorName !== undefined ? { authorName: this.requiredText(body.authorName, "product_testimonial_author_required", 280) } : {}),
      ...(body.body !== undefined ? { body: this.requiredText(body.body, "product_testimonial_body_required", 4000) } : {}),
      ...(body.authorAvatarUrl !== undefined ? { authorAvatarUrl: this.optionalUrl(body.authorAvatarUrl) } : {}),
      ...(body.rating !== undefined ? { rating: this.rating(body.rating) } : {}),
      ...(body.isPublished !== undefined ? { isPublished: body.isPublished === true } : {}),
      ...(body.moderationStatus !== undefined ? { moderationStatus: this.moderationStatus(body.moderationStatus, "approved") } : {}),
    };
    return this.serializeTestimonial(await this.testimonialRepo.update({ merchantId, id, patch }));
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Delete(":mid/products/:pid/testimonials/:tid")
  async deleteTestimonial(@Param("mid") merchantId: string, @Param("pid") productId: string, @Param("tid") id: string) {
    await this.assertProduct(merchantId, productId);
    await this.assertResourceBelongsToProduct(this.testimonialRepo.listAllForMerchant({ merchantId, productId }), id);
    await this.testimonialRepo.delete({ merchantId, id });
    return { deleted: true };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/videos")
  async listVideos(@Param("mid") merchantId: string, @Param("pid") productId: string) {
    await this.assertProduct(merchantId, productId);
    return { videos: (await this.videoRepo.listAllForMerchant({ merchantId, productId })).map((video) => this.serializeVideo(video)) };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/videos/create")
  async upsertVideo(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { id?: unknown; title?: unknown; videoUrl?: unknown; thumbnailUrl?: unknown; durationSeconds?: unknown; isPublished?: unknown; moderationStatus?: unknown },
    @Req() req: Request,
  ) {
    await this.assertProduct(merchantId, productId);
    const input = this.videoInput(body);
    const actor = this.actor(req, merchantId);
    if (typeof body.id === "string" && body.id) {
      await this.assertResourceBelongsToProduct(this.videoRepo.listAllForMerchant({ merchantId, productId }), body.id);
      return this.serializeVideo(await this.videoRepo.update({ merchantId, id: body.id, patch: input }));
    }
    return this.serializeVideo(await this.videoRepo.create({ merchantId, productId, source: "merchant", ...input }, actor));
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Put(":mid/products/:pid/videos/:vid")
  async updateVideo(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Param("vid") id: string,
    @Body() body: { title?: unknown; videoUrl?: unknown; thumbnailUrl?: unknown; durationSeconds?: unknown; isPublished?: unknown; moderationStatus?: unknown },
  ) {
    await this.assertProduct(merchantId, productId);
    const existing = (await this.videoRepo.listAllForMerchant({ merchantId, productId }))
      .find((video) => video.id === id);
    if (!existing) {
      throw new NotFoundException({ code: "product_content_resource_not_found" });
    }
    return this.serializeVideo(await this.videoRepo.update({
      merchantId,
      id,
      patch: this.videoInput({
        title: body.title ?? existing.title,
        videoUrl: body.videoUrl ?? existing.videoUrl,
        thumbnailUrl: body.thumbnailUrl ?? existing.thumbnailUrl,
        durationSeconds: body.durationSeconds ?? existing.durationSeconds,
        isPublished: body.isPublished ?? existing.isPublished,
        moderationStatus: body.moderationStatus ?? existing.moderationStatus,
      }),
    }));
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Delete(":mid/products/:pid/videos/:vid")
  async deleteVideo(@Param("mid") merchantId: string, @Param("pid") productId: string, @Param("vid") id: string) {
    await this.assertProduct(merchantId, productId);
    await this.assertResourceBelongsToProduct(this.videoRepo.listAllForMerchant({ merchantId, productId }), id);
    await this.videoRepo.delete({ merchantId, id });
    return { deleted: true };
  }

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/content/revert")
  async revert(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { historyId?: string },
    @Req() req: Request,
  ) {
    const historyId = body.historyId;
    if (!historyId || typeof historyId !== "string") {
      throw new NotFoundException({ code: "history_id_required" });
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }
    const principal = (req as Request & { user?: { userId?: string } }).user;
    const actorId = principal?.userId ?? "system";
    const result = await this.revertContent.execute({
      merchantId,
      productId,
      historyId,
      actor: { id: actorId },
    });
    return {
      productId,
      historyId,
      version: result.version,
      locale: result.locale,
      blocks: result.blocks.map((b) => ({
        id: b.id,
        productId: b.productId,
        type: b.type,
        order: b.order,
        isEnabled: b.isEnabled,
        locale: b.locale,
      })),
    };
  }

  /**
   * Upload an image (data URI base64) for use inside an Advanced Product
   * Layout block. Returns the CDN URL the editor should persist on the block.
   *
   * No ProductMedia row is created — the URL lives on the block's `props`
   * payload, matching the storefront renderer's read path.
   */
  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Post(":mid/products/:pid/content/upload")
  async uploadContentImage(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { image?: string; folder?: string },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }
    const image = body?.image;
    if (!image || typeof image !== "string" || !this.isAllowedContentUpload(image)) {
      throw new BadRequestException({ code: "invalid_image_data_uri" });
    }
    if (!this.s3.isConfigured()) {
      throw new BadRequestException({ code: "s3_not_configured" });
    }
    const folder =
      typeof body.folder === "string" && body.folder.startsWith(`merchants/${merchantId}/`)
        ? body.folder
        : `merchants/${merchantId}/products/content`;
    const result = await this.s3.uploadBase64(image, folder);
    return { url: result.url };
  }

  private async assertProduct(merchantId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }
  }

  private actor(req: Request, merchantId: string) {
    const principal = (req as Request & { user?: { userId?: string } }).user;
    return { id: principal?.userId ?? "system", merchantId };
  }

  private requiredText(value: unknown, code: string, maxLength: number): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
      throw new BadRequestException({ code });
    }
    return value.trim();
  }

  private optionalUrl(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      throw new BadRequestException({ code: "product_content_url_invalid" });
    }
    try {
      return assertSafeUrl(value);
    } catch {
      throw new BadRequestException({ code: "product_content_url_invalid" });
    }
  }

  private nonNegativeInteger(value: unknown, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException({ code: "product_content_order_invalid" });
    }
    return value;
  }

  private rating(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
      throw new BadRequestException({ code: "product_testimonial_rating_invalid" });
    }
    return value;
  }

  private moderationStatus(value: unknown, fallback: "pending" | "approved" | "rejected") {
    if (value === undefined) return fallback;
    if (value !== "pending" && value !== "approved" && value !== "rejected") {
      throw new BadRequestException({ code: "product_content_moderation_status_invalid" });
    }
    return value;
  }

  private videoInput(body: { title?: unknown; videoUrl?: unknown; thumbnailUrl?: unknown; durationSeconds?: unknown; isPublished?: unknown; moderationStatus?: unknown }) {
    const videoUrl = this.optionalUrl(body.videoUrl);
    if (!videoUrl) {
      throw new BadRequestException({ code: "product_video_url_required" });
    }
    let durationSeconds: number | null = null;
    if (body.durationSeconds !== undefined && body.durationSeconds !== null && body.durationSeconds !== "") {
      if (typeof body.durationSeconds !== "number" || !Number.isInteger(body.durationSeconds) || body.durationSeconds < 0) {
        throw new BadRequestException({ code: "product_video_duration_invalid" });
      }
      durationSeconds = body.durationSeconds;
    }
    return {
      title: this.requiredText(body.title, "product_video_title_required", 200),
      videoUrl,
      thumbnailUrl: this.optionalUrl(body.thumbnailUrl),
      durationSeconds,
      isPublished: body.isPublished === true,
      moderationStatus: this.moderationStatus(body.moderationStatus, "approved"),
    };
  }

  private async assertResourceBelongsToProduct(
    resourcePromise: Promise<Array<{ id: string }>>,
    id: string,
  ): Promise<void> {
    const resources = await resourcePromise;
    if (!resources.some((resource) => resource.id === id)) {
      throw new NotFoundException({ code: "product_content_resource_not_found" });
    }
  }

  private serializeBlock(block: {
    id: string; productId: string; type: string; props: Readonly<Record<string, unknown>>;
    order: number; isEnabled: boolean; locale: string;
  }) {
    return { id: block.id, productId: block.productId, type: block.type, props: block.props, order: block.order, isEnabled: block.isEnabled, locale: block.locale };
  }

  private serializeFaq(faq: { id: string; productId: string; question: string; answer: string; order: number; isPublished: boolean; locale: string }) {
    return { id: faq.id, productId: faq.productId, question: faq.question, answer: faq.answer, order: faq.order, isPublished: faq.isPublished, locale: faq.locale };
  }

  private serializeTestimonial(testimonial: {
    id: string; productId: string; authorName: string; authorAvatarUrl: string | null; body: string;
    rating: number | null; source: string; buyerId: string | null; orderId: string | null;
    moderationStatus: string; isPublished: boolean; locale: string;
  }) {
    return {
      id: testimonial.id, productId: testimonial.productId, authorName: testimonial.authorName,
      authorAvatarUrl: testimonial.authorAvatarUrl, body: testimonial.body, rating: testimonial.rating,
      source: testimonial.source, buyerId: testimonial.buyerId, orderId: testimonial.orderId,
      moderationStatus: testimonial.moderationStatus, isPublished: testimonial.isPublished, locale: testimonial.locale,
    };
  }

  private serializeVideo(video: {
    id: string; productId: string; title: string; videoUrl: string; thumbnailUrl?: string | null;
    durationSeconds?: number | null; source: string; buyerId?: string | null; moderationStatus: string;
    isPublished: boolean; locale: string;
  }) {
    return {
      id: video.id, productId: video.productId, title: video.title, videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl ?? null, durationSeconds: video.durationSeconds ?? null,
      source: video.source, buyerId: video.buyerId ?? null, moderationStatus: video.moderationStatus,
      isPublished: video.isPublished, locale: video.locale,
    };
  }

  private isAllowedContentUpload(dataUri: string): boolean {
    const match = /^data:(image\/(?:png|jpeg|webp|gif)|video\/mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
    if (!match) return false;
    const contentType = match[1]!;
    const buffer = Buffer.from(match[2]!, "base64");
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return false;
    if (contentType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (contentType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (contentType === "image/gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
    if (contentType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
}
