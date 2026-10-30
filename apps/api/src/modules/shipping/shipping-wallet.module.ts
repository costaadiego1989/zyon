import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { MessagingChannelsModule } from "../notifications/messaging-channels.module.js";
import { ShippingQuotesModule } from "./shipping-quotes.module.js";
import { ShippingWalletService } from "./application/shipping-wallet.service.js";
import { ShippingWalletMonitorJob } from "./application/shipping-wallet-monitor.job.js";
import { ShippingWalletController } from "./presentation/http/shipping-wallet.controller.js";
import { SHIPPING_WALLET_PROVIDER } from "./domain/ports/shipping-wallet-provider.port.js";
import { MelhorEnvioWalletAdapter } from "./infrastructure/adapters/melhor-envio-wallet.adapter.js";
import { decryptCommerceSecret } from "../commerce/infrastructure/commerce-secret-cipher.js";

@Module({
  imports: [IntegrationsModule, ShippingQuotesModule, MessagingChannelsModule],
  controllers: [ShippingWalletController],
  providers: [ShippingWalletService, ShippingWalletMonitorJob, { provide: SHIPPING_WALLET_PROVIDER,
    useFactory: () => new MelhorEnvioWalletAdapter((encrypted, token) => decryptCommerceSecret(encrypted) === token),
  }],
})
export class ShippingWalletModule {}
