import { Module } from '@nestjs/common';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { ProductsV1Controller } from './presentation/http/products-v1.controller.js';

/**
 * Public API v1 — Products submodule.
 *
 * Thin presentation layer that delegates to existing CatalogModule use-cases.
 * No business logic here — only HTTP → use-case → DTO mapping.
 */
@Module({
  imports: [CatalogModule],
  controllers: [ProductsV1Controller],
})
export class PublicApiProductsModule {}
