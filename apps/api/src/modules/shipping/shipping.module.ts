import { Module } from "@nestjs/common";
import { SHIPPING_QUOTE_REPOSITORY } from "./domain/ports/shipping-quote-repository.port.js";
import { SHIPPING_METHOD_REPOSITORY } from "./domain/ports/shipping-method-repository.port.js";
import { CARRIER_ADAPTERS } from "./domain/ports/carrier.port.js";
import { InMemoryShippingQuoteRepository } from "./infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryShippingMethodRepository } from "./infrastructure/repositories/in-memory-shipping-method.repository.js";
import { FlatRateCarrierAdapter } from "./infrastructure/adapters/flat-rate.carrier.js";
import { MelhorEnvioCarrierAdapter } from "./infrastructure/adapters/melhor-envio.carrier.js";
import { QuoteShippingUseCase } from "./application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "./application/use-cases/select-shipping-method.use-case.js";
import { WidgetShippingController } from "./presentation/http/widget-shipping.controller.js";

@Module({
  controllers: [WidgetShippingController],
  providers: [
    InMemoryShippingQuoteRepository,
    InMemoryShippingMethodRepository,
    FlatRateCarrierAdapter,
    MelhorEnvioCarrierAdapter,
    { provide: SHIPPING_QUOTE_REPOSITORY, useExisting: InMemoryShippingQuoteRepository },
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
