import { forwardRef, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { SHIPPING_QUOTE_REPOSITORY } from "./domain/ports/shipping-quote-repository.port.js";
import { SHIPPING_METHOD_REPOSITORY } from "./domain/ports/shipping-method-repository.port.js";
import { CARRIER_ADAPTERS } from "./domain/ports/carrier.port.js";
import { InMemoryShippingQuoteRepository } from "./infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { PrismaShippingQuoteRepository } from "./infrastructure/repositories/prisma-shipping-quote.repository.js";
import { InMemoryShippingMethodRepository } from "./infrastructure/repositories/in-memory-shipping-method.repository.js";
import { FlatRateCarrierAdapter } from "./infrastructure/adapters/flat-rate.carrier.js";
import { MelhorEnvioCarrierAdapter } from "./infrastructure/adapters/melhor-envio.carrier.js";
import { QuoteShippingUseCase } from "./application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "./application/use-cases/select-shipping-method.use-case.js";
import { WidgetShippingController } from "./presentation/http/widget-shipping.controller.js";
import { EmbedShippingController } from "./presentation/http/embed-shipping.controller.js";
import { EmbedAuthGuard } from "../embed/presentation/http/embed-auth.guard.js";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

function usePrismaShipping(): boolean {
  return process.env.SHIPPING_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma";
}

@Module({
  imports: [MerchantModule, forwardRef(() => CheckoutModule)],
  controllers: [WidgetShippingController, EmbedShippingController],
  providers: [
    EmbedTokenService,
    EmbedAuthGuard,
    InMemoryShippingQuoteRepository,
    InMemoryShippingMethodRepository,
    FlatRateCarrierAdapter,
    MelhorEnvioCarrierAdapter,
    {
      provide: SHIPPING_QUOTE_REPOSITORY,
      useFactory: (memory: InMemoryShippingQuoteRepository, prisma: PrismaClient) =>
        usePrismaShipping() ? new PrismaShippingQuoteRepository(prisma) : memory,
      inject: [InMemoryShippingQuoteRepository, PRISMA_CLIENT]
    },
    { provide: SHIPPING_METHOD_REPOSITORY, useExisting: InMemoryShippingMethodRepository },
    {
      provide: CARRIER_ADAPTERS,
      useFactory: (flat: FlatRateCarrierAdapter, melhorEnvio: MelhorEnvioCarrierAdapter) => [melhorEnvio, flat],
      inject: [FlatRateCarrierAdapter, MelhorEnvioCarrierAdapter]
    },
    QuoteShippingUseCase,
    SelectShippingMethodUseCase
  ],
  exports: [QuoteShippingUseCase]
})
export class ShippingModule {}
