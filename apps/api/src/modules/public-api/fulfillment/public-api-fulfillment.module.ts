import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../../fulfillment/fulfillment.module.js';
import { FulfillmentV1Controller } from './presentation/http/fulfillment-v1.controller.js';

@Module({
  imports: [FulfillmentModule],
  controllers: [FulfillmentV1Controller],
})
export class PublicApiFulfillmentModule {}
