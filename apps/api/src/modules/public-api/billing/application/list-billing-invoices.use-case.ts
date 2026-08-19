import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../../../../shared/persistence/persistence.module.js';

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
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<BillingInvoice[]> {
    const subscription = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: merchantId.trim() },
    });

    if (!subscription?.stripeCustomerId) {
      return [];
    }

    // Placeholder: In production, this would query Stripe API for invoices.
    // For now, return empty array — future integrations will populate via Stripe webhooks.
    // The data structure is defined in the BillingInvoice interface for consistency.
    return [];
  }
}
