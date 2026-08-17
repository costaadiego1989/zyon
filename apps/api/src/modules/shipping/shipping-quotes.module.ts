import { Logger, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CARRIER_ADAPTERS } from "./domain/ports/carrier.port.js";
import { SHIPPING_QUOTE_REPOSITORY } from "./domain/ports/shipping-quote-repository.port.js";
import { QuoteShippingUseCase } from "./application/use-cases/quote-shipping.use-case.js";
import { FlatRateCarrierAdapter } from "./infrastructure/adapters/flat-rate.carrier.js";
import { MelhorEnvioCarrierAdapter } from "./infrastructure/adapters/melhor-envio.carrier.js";
import { PrismaShippingQuoteRepository } from "./infrastructure/repositories/prisma-shipping-quote.repository.js";

@Module({
  imports: [MerchantModule],
  providers: [
    FlatRateCarrierAdapter,
    {
      provide: MelhorEnvioCarrierAdapter,
      useFactory: () => {
        const token = process.env.MELHOR_ENVIO_TOKEN;
        if (!token) {
          Logger.warn("MelhorEnvio adapter initialized without MELHOR_ENVIO_TOKEN; quotes will only use flat-rate carrier", "ShippingModule");
        }
        return new MelhorEnvioCarrierAdapter();
      }
    },
    {
      provide: SHIPPING_QUOTE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaShippingQuoteRepository(prisma),
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
    MelhorEnvioCarrierAdapter,
    QuoteShippingUseCase
  ]
})
export class ShippingQuotesModule {}
