import { Module } from "@nestjs/common";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { AddStorefrontItemUseCase } from "./application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "./application/search-storefront-products.use-case.js";
import { STOREFRONT_CATALOG_PORT } from "./domain/ports/storefront-catalog.port.js";
import { TenantStorefrontCatalogAdapter } from "./infrastructure/tenant-storefront-catalog.adapter.js";
import { CatalogController } from "./presentation/http/catalog.controller.js";

@Module({
  imports: [
    CheckoutModule,
    MerchantModule,
    CommerceModule,
    IntegrationsModule,
  ],
  controllers: [CatalogController],
  providers: [
    TenantStorefrontCatalogAdapter,
    SearchStorefrontProductsUseCase,
    AddStorefrontItemUseCase,
    {
      provide: STOREFRONT_CATALOG_PORT,
      useExisting: TenantStorefrontCatalogAdapter,
    }
  ],
  exports: [SearchStorefrontProductsUseCase, AddStorefrontItemUseCase]
})
export class CatalogModule {}
