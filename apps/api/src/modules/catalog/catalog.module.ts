import { Module } from "@nestjs/common";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { AddStorefrontItemUseCase } from "./application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "./application/search-storefront-products.use-case.js";
import { STOREFRONT_CATALOG_PORT } from "./domain/ports/storefront-catalog.port.js";
import { FakeStorefrontCatalogAdapter } from "./infrastructure/fake-storefront-catalog.adapter.js";

@Module({
  imports: [CheckoutModule, MerchantModule],
  providers: [
    FakeStorefrontCatalogAdapter,
    SearchStorefrontProductsUseCase,
    AddStorefrontItemUseCase,
    { provide: STOREFRONT_CATALOG_PORT, useExisting: FakeStorefrontCatalogAdapter }
  ],
  exports: [SearchStorefrontProductsUseCase, AddStorefrontItemUseCase]
})
export class CatalogModule {}
