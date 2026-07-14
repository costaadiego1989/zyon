import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { AddStorefrontItemUseCase } from "./application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "./application/search-storefront-products.use-case.js";
import { STOREFRONT_CATALOG_PORT } from "./domain/ports/storefront-catalog.port.js";
import { CROSS_SELL_RESOLVER_PORT } from "./domain/ports/cross-sell-resolver.port.js";
import { TenantStorefrontCatalogAdapter } from "./infrastructure/tenant-storefront-catalog.adapter.js";
import { DefaultCrossSellResolverAdapter } from "./infrastructure/default-cross-sell-resolver.adapter.js";
import { CatalogController } from "./presentation/http/catalog.controller.js";

@Module({
  imports: [
    CommerceModule,
    IntegrationsModule,
    CheckoutModule,
    MerchantModule,
  ],
  controllers: [CatalogController],
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
  ],
  exports: [SearchStorefrontProductsUseCase, AddStorefrontItemUseCase]
})
export class CatalogModule {}
