import { Module } from "@nestjs/common";
import { CrossSellModule } from "./cross-sell.module.js";
import { EmbedModule } from "../embed/embed.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { WidgetCrossSellController } from "./presentation/http/widget-cross-sell.controller.js";

/**
 * Non-production registration of the buyer-facing cross-sell endpoints
 * (`/embed/cross-sell/*`).
 *
 * The production composition deliberately omits WidgetCrossSellController from
 * embed.module.ts (enforced by production-composition-architecture.spec.ts).
 * This module layers it in for e2e / local runs only and is imported solely by
 * E2eAppModule. CrossSellModule is @Global, so the use-cases it exports satisfy
 * both this controller and the @Optional cross-sell dependency in
 * SendChatMessageUseCase.
 */
@Module({
  imports: [CrossSellModule, EmbedModule, CheckoutModule, MerchantModule],
  controllers: [WidgetCrossSellController],
})
export class WidgetCrossSellE2eModule {}
