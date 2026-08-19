import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { CommerceModule } from '../../commerce/commerce.module.js';
import { CommerceV1Controller } from './presentation/http/commerce-v1.controller.js';

@Module({
  imports: [IntegrationsModule, CommerceModule],
  controllers: [CommerceV1Controller],
})
export class PublicApiCommerceModule {}
