import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { StoreAnalyticsModule } from '../../store-analytics/store-analytics.module.js';
import { AnalyticsV1Controller } from './presentation/http/analytics-v1.controller.js';

@Module({
  imports: [IntegrationsModule, StoreAnalyticsModule],
  controllers: [AnalyticsV1Controller],
})
export class PublicApiAnalyticsModule {}
