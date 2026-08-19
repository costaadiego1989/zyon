import { Module } from "@nestjs/common";
import { MarketplaceModule } from "../../marketplace/marketplace.module.js";
import { MarketplaceV1Controller } from "./presentation/http/marketplace-v1.controller.js";

@Module({
  imports: [MarketplaceModule],
  controllers: [MarketplaceV1Controller],
})
export class PublicApiMarketplaceModule {}
