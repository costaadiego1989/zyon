import { Module } from '@nestjs/common';
import { PublicApiCheckoutsModule } from './checkouts/public-api-checkouts.module.js';
import { PublicApiOrdersModule } from './orders/public-api-orders.module.js';
import { PublicApiProductsModule } from './products/public-api-products.module.js';

/**
 * Public API v1 — Root barrel module.
 *
 * Aggregates all v1 resource modules.
 * Phase 1: Checkouts, Orders, Products
 */
@Module({
  imports: [
    PublicApiCheckoutsModule,
    PublicApiOrdersModule,
    PublicApiProductsModule,
  ],
})
export class PublicApiModule {}
