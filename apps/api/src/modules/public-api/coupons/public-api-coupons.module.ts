import { Module } from '@nestjs/common';
import { CouponsModule } from '../../coupons/coupons.module.js';
import { CouponsV1Controller } from './presentation/http/coupons-v1.controller.js';

@Module({
  imports: [CouponsModule],
  controllers: [CouponsV1Controller],
})
export class PublicApiCouponsModule {}
