import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { PaymentModule } from '../../payment/payment.module.js';
import { PaymentsV1Controller } from './presentation/http/payments-v1.controller.js';

@Module({
  imports: [IntegrationsModule, PaymentModule],
  controllers: [PaymentsV1Controller],
})
export class PublicApiPaymentsModule {}
