import { Module } from '@nestjs/common';
import { StoreAnalyticsModule } from '../../store-analytics/store-analytics.module.js';
import { AnalyticsV1Controller } from './presentation/http/analytics-v1.controller.js';

@Module({
  imports: [StoreAnalyticsModule],
  controllers: [AnalyticsV1Controller],
})
export class PublicApiAnalyticsModule {}
