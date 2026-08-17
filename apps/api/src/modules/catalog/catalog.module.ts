import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CommerceModule } from "../commerce/commerce.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { EmbedAuthGuard } from "../embed/presentation/http/embed-auth.guard.js";
import { EmbedCheckoutGuardHelper } from "../embed/presentation/http/embed-checkout.controller.js";
import { AddStorefrontItemUseCase } from "./application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "./application/search-storefront-products.use-case.js";
import { AddProductUseCase } from "./application/use-cases/add-product.use-case.js";
import { SearchProductsUseCase } from "./application/use-cases/search-products.use-case.js";
import { ReserveStockUseCase } from "./application/use-cases/reserve-stock.use-case.js";
import { ConfirmStockUseCase } from "./application/use-cases/confirm-stock.use-case.js";
import { GetProductUseCase } from "./application/use-cases/get-product.use-case.js";
import { UpdateProductUseCase } from "./application/use-cases/update-product.use-case.js";
import { DeleteProductUseCase } from "./application/use-cases/delete-product.use-case.js";
import { IndexProductEmbeddingUseCase } from "./application/use-cases/index-product-embedding.use-case.js";
import { ListCategoriesUseCase } from "./application/use-cases/list-categories.use-case.js";
import { CreateCategoryUseCase } from "./application/use-cases/create-category.use-case.js";
import { UpdateCategoryUseCase } from "./application/use-cases/update-category.use-case.js";
import { DeleteCategoryUseCase } from "./application/use-cases/delete-category.use-case.js";
import { ReorderCategoriesUseCase } from "./application/use-cases/reorder-categories.use-case.js";
import { GenerateProductSeoUseCase } from "./application/use-cases/generate-product-seo.use-case.js";
import { STOREFRONT_CATALOG_PORT } from "./domain/ports/storefront-catalog.port.js";
import { CROSS_SELL_RESOLVER_PORT } from "./domain/ports/cross-sell-resolver.port.js";
import { TenantStorefrontCatalogAdapter } from "./infrastructure/tenant-storefront-catalog.adapter.js";
import { DefaultCrossSellResolverAdapter } from "./infrastructure/default-cross-sell-resolver.adapter.js";
import { CatalogCacheService } from "./infrastructure/cache/catalog-cache.service.js";
import { PrismaProductRepository } from "./infrastructure/repositories/prisma-product.repository.js";
import { PrismaStockRepository } from "./infrastructure/repositories/prisma-stock.repository.js";
import { EmbeddingService } from "./infrastructure/services/embedding.service.js";
import { StockExpiryWorker, CatalogStockExpiryScheduler } from "./infrastructure/jobs/stock-expiry.job.js";
import { PromotionExpiryScheduler, PromotionExpiryWorker } from "./infrastructure/jobs/promotion-expiry.job.js";
import { WidgetCatalogController } from "./presentation/http/widget-catalog.controller.js";
import { StoreBuilderCatalogController } from "./presentation/http/catalog.controller.js";

@Module({
  imports: [
    CommerceModule,
    IntegrationsModule,
    CheckoutModule,
    MerchantModule,
    PersistenceModule,
    RedisModule,
  ],
  controllers: [WidgetCatalogController, StoreBuilderCatalogController],
  providers: [
    EmbedTokenService,
    EmbedAuthGuard,
    EmbedCheckoutGuardHelper,
    TenantStorefrontCatalogAdapter,
    DefaultCrossSellResolverAdapter,
    CatalogCacheService,
    SearchStorefrontProductsUseCase,
    AddStorefrontItemUseCase,
    EmbeddingService,
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
    GetProductUseCase,
    UpdateProductUseCase,
    DeleteProductUseCase,
    IndexProductEmbeddingUseCase,
    ListCategoriesUseCase,
    CreateCategoryUseCase,
    UpdateCategoryUseCase,
    DeleteCategoryUseCase,
    ReorderCategoriesUseCase,
    GenerateProductSeoUseCase,
    CatalogStockExpiryScheduler,
    StockExpiryWorker,
    PromotionExpiryScheduler,
    PromotionExpiryWorker,
  ],
  exports: [
    SearchStorefrontProductsUseCase,
    AddStorefrontItemUseCase,
    AddProductUseCase,
    SearchProductsUseCase,
    ReserveStockUseCase,
    ConfirmStockUseCase,
    GetProductUseCase,
    UpdateProductUseCase,
    DeleteProductUseCase,
    IndexProductEmbeddingUseCase,
    ListCategoriesUseCase,
    CreateCategoryUseCase,
    UpdateCategoryUseCase,
    DeleteCategoryUseCase,
    ReorderCategoriesUseCase,
    CatalogCacheService,
    "ProductRepositoryPort",
    "StockRepositoryPort",
  ]
})
export class CatalogModule {}
