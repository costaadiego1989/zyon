import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { CouponsModule } from '../../coupons/coupons.module.js';
import { CouponsV1Controller } from './presentation/http/coupons-v1.controller.js';

@Module({
  imports: [IntegrationsModule, CouponsModule],
  controllers: [CouponsV1Controller],
})
export class PublicApiCouponsModule {}
