import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { FulfillmentModule } from '../../fulfillment/fulfillment.module.js';
import { FulfillmentV1Controller } from './presentation/http/fulfillment-v1.controller.js';

@Module({
  imports: [IntegrationsModule, FulfillmentModule],
  controllers: [FulfillmentV1Controller],
})
export class PublicApiFulfillmentModule {}
