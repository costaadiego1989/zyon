import { Module } from "@nestjs/common";
import { EmbedModule } from "../embed/embed.module.js";
import { CrossSellModule } from "./cross-sell.module.js";
import { WidgetCrossSellController } from "./presentation/http/widget-cross-sell.controller.js";

/**
 * Production composition for the buyer-facing, authenticated cross-sell API.
 * It keeps the endpoint outside EmbedModule while consuming Embed's exported
 * guard helper and the cross-sell use cases.
 */
@Module({
  imports: [EmbedModule, CrossSellModule],
  controllers: [WidgetCrossSellController],
})
export class WidgetCrossSellModule {}
