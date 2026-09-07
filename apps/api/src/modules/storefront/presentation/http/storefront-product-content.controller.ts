import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { GetProductContentUseCase } from "../../../catalog/application/use-cases/get-product-content.use-case.js";

/**
 * Public read endpoint for the rich product content surface.
 *
 * Guarded by `@RequirePlanFeature("advancedProductLayout")` so merchants without the
 * feature see 404 (no leak). When the feature is off, callers can continue using
 * the legacy product card endpoint; this endpoint returns 404.
 */
@Controller("storefront")
export class StorefrontProductContentController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly getProductContent: GetProductContentUseCase,
  ) {}

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Get(":slug/products/:productId/content")
  async getContent(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
  ) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { storeSlug: slug },
      select: { id: true, storeSlug: true },
    });
    if (!merchant || !merchant.storeSlug) {
      throw new NotFoundException({ code: "store_not_found" });
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId: merchant.id, isActive: true, deletedAt: null },
      select: { id: true, merchantId: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }

    const content = await this.getProductContent.execute({
      merchantId: merchant.id,
      productId: product.id,
    });

    return {
      merchantId: merchant.id,
      productId: product.id,
      ...content,
    };
  }
}
