import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../../../shared/persistence/persistence.module.js';
import { STRIPE_PLATFORM_PORT, type StripePlatformPort } from '../../../payment/domain/ports/payment-platform-provider.port.js';

export interface BillingInvoice {
  id: string;
  amountBrl: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  invoiceUrl?: string;
}

@Injectable()
export class ListBillingInvoicesUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(STRIPE_PLATFORM_PORT) private readonly stripe: StripePlatformPort,
  ) {}

  async execute(merchantId: string): Promise<BillingInvoice[]> {
    const subscription = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: merchantId.trim() },
    });

    if (!subscription?.stripeCustomerId) {
      return [];
    }

    return this.stripe.listBillingInvoices(subscription.stripeCustomerId);
  }
}
