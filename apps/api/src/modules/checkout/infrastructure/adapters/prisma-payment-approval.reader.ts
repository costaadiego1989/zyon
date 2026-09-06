import type { PrismaClient } from "@prisma/client";
import type { PaymentApprovalReader, PersistedPaymentApproval } from "../../domain/ports/payment-approval.port.js";

export class PrismaPaymentApprovalReader implements PaymentApprovalReader {
  constructor(private readonly prisma: PrismaClient) {}

  async find(merchantId: string, sessionId: string, paymentIntentId: string): Promise<PersistedPaymentApproval | null> {
    if (!merchantId || !sessionId || !paymentIntentId) return null;
    const row = await this.prisma.paymentIntent.findFirst({
      where: { id: paymentIntentId, merchantId, sessionId },
      select: {
        id: true, merchantId: true, sessionId: true, status: true, currency: true,
        amountCents: true, approvedAmountCents: true, providerPaymentId: true,
        acceptedOfferId: true, amountBreakdown: true,
      },
    });
    return row as PersistedPaymentApproval | null;
  }
}
