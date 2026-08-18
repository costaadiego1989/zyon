import { Module } from '@nestjs/common';
import { PublicApiCheckoutsModule } from './checkouts/public-api-checkouts.module.js';
import { PublicApiOrdersModule } from './orders/public-api-orders.module.js';
import { PublicApiProductsModule } from './products/public-api-products.module.js';
import { PublicApiSettingsModule } from './settings/public-api-settings.module.js';
import { PublicApiPaymentsModule } from './payments/public-api-payments.module.js';

@Module({
  imports: [
    PublicApiCheckoutsModule,
    PublicApiOrdersModule,
    PublicApiProductsModule,
    PublicApiSettingsModule,
    PublicApiPaymentsModule,
  ],
})
export class PublicApiModule {}
