import { forwardRef, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { SHIPPING_QUOTE_REPOSITORY } from "./domain/ports/shipping-quote-repository.port.js";
import { CARRIER_ADAPTERS } from "./domain/ports/carrier.port.js";
import { PrismaShippingQuoteRepository } from "./infrastructure/repositories/prisma-shipping-quote.repository.js";
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

@Module({
  imports: [MerchantModule, forwardRef(() => CheckoutModule)],
  controllers: [WidgetShippingController, EmbedShippingController],
  providers: [
    EmbedTokenService,
    EmbedAuthGuard,
    FlatRateCarrierAdapter,
    MelhorEnvioCarrierAdapter,
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
    QuoteShippingUseCase,
    SelectShippingMethodUseCase
  ],
  exports: [QuoteShippingUseCase]
})
export class ShippingModule {}
