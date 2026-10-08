import { Logger, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CARRIER_ADAPTERS } from "./domain/ports/carrier.port.js";
import { SHIPPING_QUOTE_REPOSITORY } from "./domain/ports/shipping-quote-repository.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "./domain/ports/own-delivery-config.port.js";
import { MELHOR_ENVIO_TOKEN_RESOLVER, type MelhorEnvioTokenResolver } from "./domain/ports/melhor-envio-token-resolver.port.js";
import { QuoteShippingUseCase } from "./application/use-cases/quote-shipping.use-case.js";
import { QuoteMarketplaceShippingService } from "./application/use-cases/quote-marketplace-shipping.service.js";
import { GetMarketplaceShippingContractService } from "./application/use-cases/get-marketplace-shipping-contract.service.js";
import { FlatRateCarrierAdapter } from "./infrastructure/adapters/flat-rate.carrier.js";
import { MelhorEnvioCarrierAdapter } from "./infrastructure/adapters/melhor-envio.carrier.js";
import { MelhorEnvioReverseAdapter } from "./infrastructure/adapters/melhor-envio-reverse.adapter.js";
import { PrismaMelhorEnvioTokenResolver } from "./infrastructure/adapters/prisma-melhor-envio-token-resolver.js";
import { MelhorEnvioTokenRefresher } from "./application/melhor-envio-token-refresher.js";
import { PrismaShippingQuoteRepository } from "./infrastructure/repositories/prisma-shipping-quote.repository.js";
import { PrismaOwnDeliveryConfigRepository } from "./infrastructure/repositories/prisma-own-delivery-config.repository.js";
import { PrismaMarketplaceShipmentRepository } from "./infrastructure/repositories/prisma-marketplace-shipment.repository.js";
import { MarketplaceMelhorEnvioAdapter } from "./infrastructure/adapters/marketplace-melhor-envio.adapter.js";
import { MARKETPLACE_SHIPMENT_CARRIER } from "./domain/ports/marketplace-shipment-carrier.port.js";
import { ExecuteMarketplaceShipmentService } from "./application/use-cases/execute-marketplace-shipment.service.js";
import { ShippingShipmentRecoveryController } from "./presentation/http/shipping-shipment-recovery.controller.js";
import { ShippingShipmentDashboardController } from "./presentation/http/shipping-shipment-dashboard.controller.js";
import { MarketplaceShipmentDashboardService } from "./application/marketplace-shipment-dashboard.service.js";
import { PrismaMarketplaceDeliveryRepository } from "./infrastructure/repositories/prisma-marketplace-delivery.repository.js";
import { MarketplaceDeliveryEventsHandler } from "./application/handlers/marketplace-delivery-events.handler.js";

@Module({
  imports: [MerchantModule],
  controllers: [ShippingShipmentRecoveryController, ShippingShipmentDashboardController],
  providers: [
    FlatRateCarrierAdapter,
    PrismaMarketplaceDeliveryRepository,
    MarketplaceDeliveryEventsHandler,
    { provide: PrismaMarketplaceShipmentRepository,
      useFactory: (prisma: PrismaClient, contracts: GetMarketplaceShippingContractService) => new PrismaMarketplaceShipmentRepository(prisma, contracts),
      inject: [PRISMA_CLIENT, GetMarketplaceShippingContractService] },
    { provide: MARKETPLACE_SHIPMENT_CARRIER,
      useFactory: (resolver: MelhorEnvioTokenResolver) => new MarketplaceMelhorEnvioAdapter(resolver),
      inject: [MELHOR_ENVIO_TOKEN_RESOLVER] },
    ExecuteMarketplaceShipmentService,
    MarketplaceShipmentDashboardService,
    {
      provide: MELHOR_ENVIO_TOKEN_RESOLVER,
      useFactory: (prisma: PrismaClient) =>
        new PrismaMelhorEnvioTokenResolver(prisma, new MelhorEnvioTokenRefresher(prisma)),
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
    { provide: MelhorEnvioReverseAdapter,
      useFactory: (resolver: MelhorEnvioTokenResolver) => new MelhorEnvioReverseAdapter(resolver),
      inject: [MELHOR_ENVIO_TOKEN_RESOLVER] },
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
    QuoteShippingUseCase,
    QuoteMarketplaceShippingService,
    GetMarketplaceShippingContractService
  ],
  exports: [
    PrismaMarketplaceDeliveryRepository,
    ExecuteMarketplaceShipmentService,
    PrismaMarketplaceShipmentRepository,
    SHIPPING_QUOTE_REPOSITORY,
    OWN_DELIVERY_CONFIG_REPOSITORY,
    MelhorEnvioCarrierAdapter,
    MelhorEnvioReverseAdapter,
    QuoteShippingUseCase,
    QuoteMarketplaceShippingService,
    GetMarketplaceShippingContractService
  ]
})
export class ShippingQuotesModule {}
