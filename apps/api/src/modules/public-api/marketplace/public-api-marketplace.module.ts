import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../../integrations/integrations.module.js";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { MarketplaceV1Controller } from "./presentation/http/marketplace-v1.controller.js";

@Module({
  imports: [IntegrationsModule, MarketplaceModule],
  controllers: [MarketplaceV1Controller],
})
export class PublicApiMarketplaceModule {}
