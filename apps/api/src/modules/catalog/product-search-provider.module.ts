/**
 * ProductSearchProviderModule is intentionally minimal.
 * The PRODUCT_SEARCH_PORT token is registered directly in CheckoutModule
 * to avoid circular dependency issues with CatalogModule.
 * This file is kept as a placeholder for future catalog expansion.
 */
import { Module } from "@nestjs/common";

@Module({})
export class ProductSearchProviderModule {}
