import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CommerceModule } from "../commerce/commerce.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { AddStorefrontItemUseCase } from "./application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "./application/search-storefront-products.use-case.js";
import { AddProductUseCase } from "./application/use-cases/add-product.use-case.js";
import { SearchProductsUseCase } from "./application/use-cases/search-products.use-case.js";
import { ReserveStockUseCase } from "./application/use-cases/reserve-stock.use-case.js";
import { ConfirmStockUseCase } from "./application/use-cases/confirm-stock.use-case.js";
import { STOREFRONT_CATALOG_PORT } from "./domain/ports/storefront-catalog.port.js";
import { CROSS_SELL_RESOLVER_PORT } from "./domain/ports/cross-sell-resolver.port.js";
import { TenantStorefrontCatalogAdapter } from "./infrastructure/tenant-storefront-catalog.adapter.js";
import { DefaultCrossSellResolverAdapter } from "./infrastructure/default-cross-sell-resolver.adapter.js";
import { PrismaProductRepository } from "./infrastructure/repositories/prisma-product.repository.js";
import { PrismaStockRepository } from "./infrastructure/repositories/prisma-stock.repository.js";
import { StockExpiryWorker, CatalogStockExpiryScheduler } from "./infrastructure/jobs/stock-expiry.job.js";
import { WidgetCatalogController } from "./presentation/http/widget-catalog.controller.js";
import { StoreBuilderCatalogController } from "./presentation/http/catalog.controller.js";

@Module({
  imports: [
    CommerceModule,
    IntegrationsModule,
    CheckoutModule,
    MerchantModule,
    PersistenceModule,
  ],
  controllers: [WidgetCatalogController, StoreBuilderCatalogController],
  providers: [
    TenantStorefrontCatalogAdapter,
    DefaultCrossSellResolverAdapter,
    SearchStorefrontProductsUseCase,
    AddStorefrontItemUseCase,
    {
      provide: STOREFRONT_CATALOG_PORT,
      useExisting: TenantStorefrontCatalogAdapter,
    },
    {
      provide: CROSS_SELL_RESOLVER_PORT,
      useExisting: DefaultCrossSellResolverAdapter,
    },
    {
      provide: "ProductRepositoryPort",
      useFactory: (prisma: PrismaClient) => new PrismaProductRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: "StockRepositoryPort",
      useFactory: (prisma: PrismaClient) => new PrismaStockRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    AddProductUseCase,
    SearchProductsUseCase,
    ReserveStockUseCase,
    ConfirmStockUseCase,
    CatalogStockExpiryScheduler,
    StockExpiryWorker,
  ],
  exports: [
    SearchStorefrontProductsUseCase,
    AddStorefrontItemUseCase,
    AddProductUseCase,
    SearchProductsUseCase,
    ReserveStockUseCase,
    ConfirmStockUseCase,
    "ProductRepositoryPort",
    "StockRepositoryPort",
  ]
})
export class CatalogModule {}
