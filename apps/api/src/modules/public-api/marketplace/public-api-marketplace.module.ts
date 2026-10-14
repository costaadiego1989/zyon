import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../../integrations/integrations.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { MarketplaceV1Controller } from "./presentation/http/marketplace-v1.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../../payment/domain/billing-plan-guard.js";

@Module({
  imports: [IntegrationsModule, MarketplaceModule],
  controllers: [MarketplaceV1Controller],
  providers: [BillingPlanMeteringService, PlanLimitGuard],
})
export class PublicApiMarketplaceModule {}
