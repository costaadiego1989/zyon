import { Module } from "@nestjs/common";
import { MarketplaceModule } from "../marketplace/marketplace.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { MarketplaceV1Controller } from "../public-api/marketplace/presentation/http/marketplace-v1.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

/**
 * Dashboard-specific marketplace module.
 * Exposes marketplace endpoints for dashboard UI (config, orders, stats).
 */
@Module({
  imports: [MarketplaceModule, IntegrationsModule],
  controllers: [MarketplaceV1Controller],
  providers: [BillingPlanMeteringService, PlanLimitGuard],
})
export class DashboardMarketplaceModule {}
