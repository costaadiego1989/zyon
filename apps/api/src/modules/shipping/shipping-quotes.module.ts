import { Logger, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CARRIER_ADAPTERS } from "./domain/ports/carrier.port.js";
import { SHIPPING_QUOTE_REPOSITORY } from "./domain/ports/shipping-quote-repository.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "./domain/ports/own-delivery-config.port.js";
import { MELHOR_ENVIO_TOKEN_RESOLVER, type MelhorEnvioTokenResolver } from "./domain/ports/melhor-envio-token-resolver.port.js";
import { QuoteShippingUseCase } from "./application/use-cases/quote-shipping.use-case.js";
import { FlatRateCarrierAdapter } from "./infrastructure/adapters/flat-rate.carrier.js";
import { MelhorEnvioCarrierAdapter } from "./infrastructure/adapters/melhor-envio.carrier.js";
import { PrismaMelhorEnvioTokenResolver } from "./infrastructure/adapters/prisma-melhor-envio-token-resolver.js";
import { PrismaShippingQuoteRepository } from "./infrastructure/repositories/prisma-shipping-quote.repository.js";
import { PrismaOwnDeliveryConfigRepository } from "./infrastructure/repositories/prisma-own-delivery-config.repository.js";

@Module({
  imports: [MerchantModule],
  providers: [
    FlatRateCarrierAdapter,
    {
      provide: MELHOR_ENVIO_TOKEN_RESOLVER,
      useFactory: (prisma: PrismaClient) => new PrismaMelhorEnvioTokenResolver(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: MelhorEnvioCarrierAdapter,
      useFactory: (resolver: MelhorEnvioTokenResolver) => {
        if (!process.env.MELHOR_ENVIO_TOKEN) {
          Logger.warn("MelhorEnvio: no global MELHOR_ENVIO_TOKEN fallback; merchants without a connected OAuth account will get flat-rate only", "ShippingModule");
        }
        return new MelhorEnvioCarrierAdapter(resolver);
      },
      inject: [MELHOR_ENVIO_TOKEN_RESOLVER]
    },
    {
      provide: SHIPPING_QUOTE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaShippingQuoteRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: OWN_DELIVERY_CONFIG_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaOwnDeliveryConfigRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: CARRIER_ADAPTERS,
      useFactory: (flat: FlatRateCarrierAdapter, melhorEnvio: MelhorEnvioCarrierAdapter) => [melhorEnvio, flat],
      inject: [FlatRateCarrierAdapter, MelhorEnvioCarrierAdapter]
    },
    QuoteShippingUseCase
  ],
  exports: [
    SHIPPING_QUOTE_REPOSITORY,
    OWN_DELIVERY_CONFIG_REPOSITORY,
    MelhorEnvioCarrierAdapter,
    QuoteShippingUseCase
  ]
})
export class ShippingQuotesModule {}
