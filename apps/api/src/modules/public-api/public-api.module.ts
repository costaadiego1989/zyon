import { Module } from '@nestjs/common';
import { PublicApiCheckoutsModule } from './checkouts/public-api-checkouts.module.js';
import { PublicApiOrdersModule } from './orders/public-api-orders.module.js';
import { PublicApiProductsModule } from './products/public-api-products.module.js';
import { PublicApiSettingsModule } from './settings/public-api-settings.module.js';
import { PublicApiPaymentsModule } from './payments/public-api-payments.module.js';
import { PublicApiCategoriesModule } from './categories/public-api-categories.module.js';
import { PublicApiWebhooksModule } from './webhooks/public-api-webhooks.module.js';
import { PublicApiExperimentsModule } from './experiments/public-api-experiments.module.js';
import { PublicApiCouponsModule } from './coupons/public-api-coupons.module.js';
import { PublicApiAnalyticsModule } from './analytics/public-api-analytics.module.js';
import { PublicApiCustomersModule } from './customers/public-api-customers.module.js';
import { PublicApiTeamModule } from './team/public-api-team.module.js';
import { PublicApiReturnsModule } from './returns/public-api-returns.module.js';

@Module({
  imports: [
    PublicApiCheckoutsModule,
    PublicApiOrdersModule,
    PublicApiProductsModule,
    PublicApiSettingsModule,
    PublicApiPaymentsModule,
    PublicApiCategoriesModule,
    PublicApiWebhooksModule,
    PublicApiCouponsModule,
    PublicApiExperimentsModule,
    PublicApiAnalyticsModule,
    PublicApiCustomersModule,
    PublicApiTeamModule,
    PublicApiReturnsModule,
  ],
})
export class PublicApiModule {}
