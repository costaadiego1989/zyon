import { Module } from '@nestjs/common';
import { PaymentModule } from '../../payment/payment.module.js';
import { BillingV1Controller } from './presentation/http/billing-v1.controller.js';
import { ListBillingPlansUseCase } from './application/list-billing-plans.use-case.js';
import { GetBillingUsageUseCase } from './application/get-billing-usage.use-case.js';
import { ListBillingInvoicesUseCase } from './application/list-billing-invoices.use-case.js';

@Module({
  imports: [PaymentModule],
  controllers: [BillingV1Controller],
  providers: [ListBillingPlansUseCase, GetBillingUsageUseCase, ListBillingInvoicesUseCase],
})
export class PublicApiBillingModule {}
