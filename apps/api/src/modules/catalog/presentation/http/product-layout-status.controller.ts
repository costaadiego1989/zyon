import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { ListProductLayoutStatusUseCase } from "../../application/use-cases/list-product-layout-status.use-case.js";

/**
 * Wave 2 — Layout status summary for the dashboard
 * "Conteúdo Avançado" list page (R5 of the Advanced Product Layout spec).
 *
 * Returns one entry per active product for the merchant, with the
 * aggregate counts of blocks / FAQs / testimonials / videos, plus the
 * most recent `updatedAt` across the layout tables.
 *
 * Tenant scope: `MerchantOwnershipGuard` plus the use case's
 * `merchantId` filter — a merchant can never read another merchant's
 * layout summary.
 *
 * Plan gate: `@RequirePlanFeature("advancedProductLayout")` returns 404
 * for merchants without the entitlement, matching the rest of the
 * R3/R4/R8 endpoints so a downgrade doesn't leak the summary shape.
 */
@Controller("merchants")
export class ProductLayoutStatusController {
  constructor(
    private readonly listLayoutStatus: ListProductLayoutStatusUseCase,
  ) {}

  @UseGuards(AuthGuard, MerchantOwnershipGuard, PlanLimitGuard)
  @RequirePlanFeature("advancedProductLayout")
  @Get(":mid/products/layout-status")
  async listLayoutStatusRoute(@Param("mid") merchantId: string) {
    const result = await this.listLayoutStatus.execute({ merchantId });
    return {
      entries: result.entries,
      total: result.total,
    };
  }
}
