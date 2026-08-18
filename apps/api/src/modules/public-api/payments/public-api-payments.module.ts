import { Module } from '@nestjs/common';
import { PaymentModule } from '../../payment/payment.module.js';
import { PaymentsV1Controller } from './presentation/http/payments-v1.controller.js';

@Module({
  imports: [PaymentModule],
  controllers: [PaymentsV1Controller],
})
export class PublicApiPaymentsModule {}
