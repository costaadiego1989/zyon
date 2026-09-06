import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/infrastructure/billing/billing-plan-guard.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CheckoutPersistenceModule } from "../checkout/checkout-persistence.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { ExperimentsModule } from "../experiments/experiments.module.js";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { EmbedAuthGuard } from "../embed/presentation/http/embed-auth.guard.js";
import { EmbedCheckoutGuardHelper } from "../embed/presentation/http/embed-checkout.controller.js";
import { AddStorefrontItemUseCase } from "./application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "./application/search-storefront-products.use-case.js";
import { AddProductUseCase } from "./application/use-cases/add-product.use-case.js";
import { ProcessSpreadsheetImportUseCase } from "./application/use-cases/process-spreadsheet-import.use-case.js";
import { EnqueueSpreadsheetImportUseCase } from "./application/use-cases/enqueue-spreadsheet-import.use-case.js";
import { GetImportJobUseCase } from "./application/use-cases/get-import-job.use-case.js";
import { IMPORT_JOB_REPOSITORY } from "./domain/ports/import-job-repository.port.js";
import { IMPORT_QUEUE } from "./domain/ports/import-queue.port.js";
import { SPREADSHEET_PARSER } from "./domain/ports/spreadsheet-parser.port.js";
import { COLUMN_MAPPER } from "./domain/ports/column-mapper.port.js";
import { PrismaImportJobRepository } from "./infrastructure/repositories/prisma-import-job.repository.js";
import { CsvXlsxParserAdapter } from "./infrastructure/csv-xlsx-parser.adapter.js";
import { DeterministicColumnMapper } from "./infrastructure/adapters/deterministic-column-mapper.adapter.js";
import { LlmColumnMapper } from "./infrastructure/adapters/llm-column-mapper.adapter.js";
import { CompositeColumnMapper } from "./infrastructure/adapters/composite-column-mapper.adapter.js";
import { SpreadsheetImportScheduler, SpreadsheetImportWorker } from "./infrastructure/jobs/spreadsheet-import.job.js";
import { SpreadsheetImportController } from "./presentation/http/spreadsheet-import.controller.js";
import { CHAT_COMPLETION_PORT } from "../support/domain/ports/chat-completion.port.js";
import { OpenAIChatAdapter } from "../support/infrastructure/openai-chat.adapter.js";
import { S3UploadService } from "../../shared/storage/s3-upload.service.js";
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
import { PRODUCT_PROMOTION_REPOSITORY } from "./domain/ports/product-promotion-repository.port.js";
import { TenantStorefrontCatalogAdapter } from "./infrastructure/tenant-storefront-catalog.adapter.js";
import { DefaultCrossSellResolverAdapter } from "./infrastructure/default-cross-sell-resolver.adapter.js";
import { CatalogCacheService } from "./infrastructure/cache/catalog-cache.service.js";
import { PrismaProductRepository } from "./infrastructure/repositories/prisma-product.repository.js";
import { PrismaStockRepository } from "./infrastructure/repositories/prisma-stock.repository.js";
import { PrismaProductPromotionRepository } from "./infrastructure/repositories/prisma-product-promotion.repository.js";
import { EmbeddingService } from "./infrastructure/services/embedding.service.js";
import { StockExpiryWorker, CatalogStockExpiryScheduler } from "./infrastructure/jobs/stock-expiry.job.js";
import { PromotionExpiryScheduler, PromotionExpiryWorker } from "./infrastructure/jobs/promotion-expiry.job.js";
import { WidgetCatalogController } from "./presentation/http/widget-catalog.controller.js";
import { StoreBuilderCatalogController } from "./presentation/http/catalog.controller.js";
import { ProductPromotionController } from "./presentation/http/product-promotion.controller.js";
import { CreateProductPromotionUseCase } from "./application/use-cases/create-product-promotion.use-case.js";
import { UpdateProductPromotionUseCase } from "./application/use-cases/update-product-promotion.use-case.js";
import { ToggleProductPromotionUseCase } from "./application/use-cases/toggle-product-promotion.use-case.js";
import { DeleteProductPromotionUseCase } from "./application/use-cases/delete-product-promotion.use-case.js";
import { UpsertProductAdvancedRulesUseCase } from "./application/use-cases/upsert-product-advanced-rules.use-case.js";
import { CheckoutSettingsModule } from "../checkout-settings/checkout-settings.module.js";
import { CatalogVariantService } from "./application/services/catalog-variant.service.js";

@Module({
  imports: [
    CommerceModule,
    IntegrationsModule,
    CheckoutPersistenceModule,
    MerchantModule,
    PersistenceModule,
    RedisModule,
    ExperimentsModule,
    CheckoutSettingsModule,
  ],
  controllers: [WidgetCatalogController, StoreBuilderCatalogController, ProductPromotionController, SpreadsheetImportController],
  providers: [
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: CatalogVariantService,
      useFactory: (prisma: PrismaClient, s3: S3UploadService) => new CatalogVariantService(prisma, s3),
      inject: [PRISMA_CLIENT, S3UploadService],
    },
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
    {
      provide: PRODUCT_PROMOTION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaProductPromotionRepository(prisma),
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
    CreateProductPromotionUseCase,
    UpdateProductPromotionUseCase,
    ToggleProductPromotionUseCase,
    DeleteProductPromotionUseCase,
    UpsertProductAdvancedRulesUseCase,
    // ── AI spreadsheet import (Growth+) ──────────────────────────────────
    S3UploadService,
    OpenAIChatAdapter,
    {
      provide: IMPORT_JOB_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaImportJobRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    { provide: SPREADSHEET_PARSER, useClass: CsvXlsxParserAdapter },
    DeterministicColumnMapper,
    { provide: CHAT_COMPLETION_PORT, useClass: OpenAIChatAdapter },
    LlmColumnMapper,
    { provide: COLUMN_MAPPER, useClass: CompositeColumnMapper },
    ProcessSpreadsheetImportUseCase,
    SpreadsheetImportWorker,
    SpreadsheetImportScheduler,
    { provide: IMPORT_QUEUE, useExisting: SpreadsheetImportScheduler },
    EnqueueSpreadsheetImportUseCase,
    GetImportJobUseCase,
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
    EmbeddingService,
    "ProductRepositoryPort",
    "StockRepositoryPort",
    PRODUCT_PROMOTION_REPOSITORY,
  ]
})
export class CatalogModule {}
