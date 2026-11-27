import { Module } from "@nestjs/common";
import { MERCHANT_MARKETING_MESSAGING } from "../../shared/contracts/marketing.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/public-api.js";
import { WhatsAppConfigModule } from "./whatsapp-config.module.js";
import { MerchantMarketingMessagingAdapter } from "./infrastructure/adapters/merchant-marketing-messaging.adapter.js";

/** Public, acyclic channel boundary; no dependency on checkout or marketing. */
@Module({
  imports: [WhatsAppConfigModule, WhatsAppTemplatesModule],
  providers: [
    {
      provide: MERCHANT_MARKETING_MESSAGING,
      useClass: MerchantMarketingMessagingAdapter,
    },
  ],
  exports: [MERCHANT_MARKETING_MESSAGING],
})
export class MerchantMarketingMessagingModule {}
