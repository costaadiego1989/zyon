import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module.js';
import { CommerceV1Controller } from './presentation/http/commerce-v1.controller.js';

@Module({
  imports: [CommerceModule],
  controllers: [CommerceV1Controller],
})
export class PublicApiCommerceModule {}
