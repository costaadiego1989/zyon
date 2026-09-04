import {
  Controller,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { CreateProductPromotionUseCase } from "../../application/use-cases/create-product-promotion.use-case.js";
import { UpdateProductPromotionUseCase } from "../../application/use-cases/update-product-promotion.use-case.js";
import { ToggleProductPromotionUseCase } from "../../application/use-cases/toggle-product-promotion.use-case.js";
import { DeleteProductPromotionUseCase } from "../../application/use-cases/delete-product-promotion.use-case.js";
import { UpsertProductAdvancedRulesUseCase } from "../../application/use-cases/upsert-product-advanced-rules.use-case.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";

/**
 * Product promotion + advanced-rules endpoints.
 *
 * - Simple promo (percent | fixed | promo-price | coupon-link) is available to ALL plans:
 *   it writes a ProductPromotion row scoped to the merchant.
 * - Advanced rules (buy-2, unlock coupon, free shipping) are gated by the billing
 *   `advancedRules` feature (Growth+) and persisted product-scoped into the merchant's
 *   checkout-settings advancedRules (consumed by the existing CartRulesEngine).
 *
 * All routes are merchant-scoped (mid param) and behind AuthGuard.
 */
@UseGuards(AuthGuard)
@Controller("merchants")
export class ProductPromotionController {
  constructor(
    private readonly createPromo: CreateProductPromotionUseCase,
    private readonly updatePromo: UpdateProductPromotionUseCase,
    private readonly togglePromo: ToggleProductPromotionUseCase,
    private readonly deletePromo: DeleteProductPromotionUseCase,
    private readonly upsertAdvancedRules: UpsertProductAdvancedRulesUseCase,
  ) {}

  @Post(":mid/products/:pid/promotion")
  async create(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: {
      variantId?: string;
      categoryId?: string;
      couponId?: string;
      discountType?: "percent" | "fixed";
      discountValue?: number;
      promoPriceInCents?: number;
      isActive?: boolean;
      startsAt: string;
      endsAt: string;
    },
  ) {
    return this.createPromo.execute({
      merchantId,
      productId,
      variantId: body.variantId,
      categoryId: body.categoryId,
      couponId: body.couponId,
      discountType: body.discountType,
      discountValue: body.discountValue,
      promoPriceInCents: body.promoPriceInCents,
      isActive: body.isActive ?? true,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
    });
  }

  @Put(":mid/products/:pid/promotion/:promoId")
  async update(
    @Param("mid") merchantId: string,
    @Param("promoId") promoId: string,
    @Body() body: {
      variantId?: string;
      categoryId?: string;
      couponId?: string;
      discountType?: "percent" | "fixed";
      discountValue?: number;
      promoPriceInCents?: number;
      isActive?: boolean;
      startsAt?: string;
      endsAt?: string;
    },
  ) {
    return this.updatePromo.execute({
      id: promoId,
      merchantId,
      data: {
        variantId: body.variantId,
        categoryId: body.categoryId,
        couponId: body.couponId,
        discountType: body.discountType,
        discountValue: body.discountValue,
        promoPriceInCents: body.promoPriceInCents,
        isActive: body.isActive,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      },
    });
  }

  @Patch(":mid/products/:pid/promotion/:promoId/toggle")
  async toggle(
    @Param("mid") merchantId: string,
    @Param("promoId") promoId: string,
    @Body() body: { isActive: boolean },
  ) {
    await this.togglePromo.execute({ id: promoId, merchantId, isActive: body.isActive });
    return { ok: true };
  }

  @Delete(":mid/products/:pid/promotion/:promoId")
  async remove(
    @Param("mid") merchantId: string,
    @Param("promoId") promoId: string,
  ) {
    await this.deletePromo.execute({ id: promoId, merchantId });
    return { ok: true };
  }

  /**
   * Advanced product rules (buy-2, unlock coupon, free shipping). Gated to Growth+
   * via the billing `advancedRules` feature. Rules are auto-scoped to the product's
   * SKUs and merged into the merchant's checkout-settings advancedRules (consumed by
   * the existing CartRulesEngine at cart time).
   */
  @Put(":mid/products/:pid/advanced-rules")
  @UseGuards(PlanLimitGuard)
  @RequirePlanFeature("advancedRules")
  async upsertRules(
    @Param("mid") merchantId: string,
    @Body() body: { productSkus: string[]; rules: AdvancedRule[] },
  ) {
    const merged = await this.upsertAdvancedRules.execute({
      merchantId,
      productSkus: body.productSkus ?? [],
      rules: body.rules ?? [],
    });
    return { rules: merged };
  }
}
