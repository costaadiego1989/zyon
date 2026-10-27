import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from "@nestjs/common";
import type { PromotionTrigger } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CreateCrossSellPromotionUseCase } from "../../application/use-cases/create-cross-sell-promotion.use-case.js";
import { UpdateCrossSellPromotionUseCase } from "../../application/use-cases/update-cross-sell-promotion.use-case.js";
import { ArchiveCrossSellPromotionUseCase } from "../../application/use-cases/archive-cross-sell-promotion.use-case.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { Inject } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanLimit } from "../../../payment/domain/billing-plan-guard.js";

@UseGuards(AuthGuard)
@Controller("merchant/cross-sell")
export class MerchantCrossSellController {
  constructor(
    private readonly create: CreateCrossSellPromotionUseCase,
    private readonly update: UpdateCrossSellPromotionUseCase,
    private readonly archive: ArchiveCrossSellPromotionUseCase,
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly repo: CrossSellPromotionRepository
  ) {}

  @Post("promotions")
  @UseGuards(PlanLimitGuard)
  @RequirePlanLimit("crossSellPromotions")
  async createPromotion(
    @Req() req: unknown,
    @Body() body: { name: string; trigger: PromotionTrigger; recommended_skus: string[]; discount_percent: number; max_discount_percent: number; starts_at: string; ends_at?: string }
  ) {
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.create.execute({
      ...body,
      merchant_id: merchantId,
      starts_at: new Date(body.starts_at),
      ends_at: body.ends_at ? new Date(body.ends_at) : undefined
    });
  }

  @Get("promotions")
  async listPromotions(@Req() req: unknown) {
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.repo.findAllByMerchant(merchantId);
  }

  @Put("promotions/:id")
  async updatePromotion(
    @Req() req: unknown,
    @Param("id") id: string,
    @Body() body: { patch?: Record<string, unknown> } & Record<string, unknown>
  ) {
    const { merchantId } = currentUser(req as { user?: unknown });
    const patch = (body.patch ?? body) as Record<string, unknown>;
    return this.update.execute({ id, merchant_id: merchantId, patch: patch as any });
  }

  @Delete("promotions/:id")
  async archivePromotion(@Req() req: unknown, @Param("id") id: string) {
    const { merchantId } = currentUser(req as { user?: unknown });
    return this.archive.execute({ id, merchant_id: merchantId });
  }
}
