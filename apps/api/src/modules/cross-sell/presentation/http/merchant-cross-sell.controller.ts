import { Controller, Get, Post, Put, Delete, Body, Param, Query } from "@nestjs/common";
import type { PromotionTrigger } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CreateCrossSellPromotionUseCase } from "../../application/use-cases/create-cross-sell-promotion.use-case.js";
import { UpdateCrossSellPromotionUseCase } from "../../application/use-cases/update-cross-sell-promotion.use-case.js";
import { ArchiveCrossSellPromotionUseCase } from "../../application/use-cases/archive-cross-sell-promotion.use-case.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { Inject } from "@nestjs/common";

@Controller("merchant/cross-sell")
export class MerchantCrossSellController {
  constructor(
    private readonly create: CreateCrossSellPromotionUseCase,
    private readonly update: UpdateCrossSellPromotionUseCase,
    private readonly archive: ArchiveCrossSellPromotionUseCase,
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly repo: CrossSellPromotionRepository
  ) {}

  @Post("promotions")
  async createPromotion(
    @Body() body: { merchant_id: string; name: string; trigger: PromotionTrigger; recommended_skus: string[]; discount_percent: number; max_discount_percent: number; starts_at: string; ends_at?: string }
  ) {
    return this.create.execute({
      ...body,
      starts_at: new Date(body.starts_at),
      ends_at: body.ends_at ? new Date(body.ends_at) : undefined
    });
  }

  @Get("promotions")
  async listPromotions(@Query("merchant_id") merchantId: string) {
    return this.repo.findAllByMerchant(merchantId);
  }

  @Put("promotions/:id")
  async updatePromotion(
    @Param("id") id: string,
    @Body() body: { merchant_id: string; patch: Record<string, unknown> }
  ) {
    return this.update.execute({ id, merchant_id: body.merchant_id, patch: body.patch as any });
  }

  @Delete("promotions/:id")
  async archivePromotion(@Param("id") id: string, @Body() body: { merchant_id: string }) {
    return this.archive.execute({ id, merchant_id: body.merchant_id });
  }
}
