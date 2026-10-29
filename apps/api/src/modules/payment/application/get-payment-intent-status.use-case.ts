import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { assertPaymentAmount, orderTotalCents } from "../domain/payment-amount.js";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";

export type GetPaymentIntentStatusRequest = {
  merchant_id: string;
  session_id: string;
  intent_id: string;
};

export type GetPaymentIntentStatusResponse = {
  intent_id: string;
  status: string;
  amount_cents: number;
  approved_amount_cents?: number;
  currency: string;
  method: string;
  order_id?: string;
  checkout_status?: "pending" | "completed";
  provider_payment_id?: string;
  receipt_url?: string;
};

/**
 * Authoritative read of a payment intent's persisted status. Webhooks are the
 * source of truth that flip the status to `approved`; the widget polls this to
 * resolve PIX/async charges without optimistic client-side confirmation.
 */
@Injectable()
export class GetPaymentIntentStatusUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async execute(input: GetPaymentIntentStatusRequest): Promise<GetPaymentIntentStatusResponse> {
    const merchantId = input.merchant_id.trim();
    const sessionId = input.session_id.trim();
    const intentId = input.intent_id.trim();
    if (!merchantId || !sessionId || !intentId) {
      throw new BadRequestException("payment_status_fields_required");
    }

    const intentRow = await this.payments.getIntentById(merchantId, intentId);
    if (!intentRow) throw new NotFoundException("payment_intent_not_found");

    const snap = intentRow.snapshot();
    // Session boundary: the tenant boundary is enforced at the port via merchantId.
    if (snap.sessionId !== sessionId || snap.merchantId !== merchantId || snap.id !== intentId) {
      throw new NotFoundException("payment_intent_not_found");
    }

    // Capture and order completion can commit separately. A provider charge ID
    // alone must never tell a marketplace buyer that their order is completed.
    const marketplace = snap.creation?.input.marketplaceFunding !== undefined ||
      snap.creation?.input.marketplacePublicAdmission !== undefined ||
      Boolean(await this.prisma?.marketplaceFundingPlan.findUnique({
        where: { paymentIntentId: intentId }, select: { paymentIntentId: true },
      }));
    const completedOrderId = marketplace ? await this.marketplaceCompletedOrder(snap) : undefined;
    return {
      intent_id: intentId,
      status: snap.status,
      amount_cents: snap.amountCents,
      approved_amount_cents: snap.approvedAmountCents,
      currency: snap.currency,
      method: snap.method,
      order_id: marketplace ? completedOrderId : snap.commerceOrderId ?? snap.providerPaymentId,
      ...(marketplace ? { checkout_status: completedOrderId ? "completed" as const : "pending" as const } : {}),
      provider_payment_id: snap.providerPaymentId,
      ...(!marketplace && snap.buyerFacing?.invoiceUrl ? { receipt_url: snap.buyerFacing.invoiceUrl } : {})
    };
  }

  private async marketplaceCompletedOrder(snap: PaymentIntentSnapshot): Promise<string | undefined> {
    if (!this.prisma || snap.status !== "approved" || !snap.providerPaymentId ||
      snap.approvedAmountCents !== snap.amountCents || !snap.amountBreakdown) return undefined;
    try { assertPaymentAmount(snap.amountBreakdown, snap.amountCents, snap.currency); }
    catch { return undefined; }
    const order = await this.prisma.completedOrder.findUnique({
      where: { merchantId_sessionId_externalOrderId: {
        merchantId: snap.merchantId, sessionId: snap.sessionId, externalOrderId: snap.providerPaymentId,
      } },
      select: { merchantId: true, sessionId: true, externalOrderId: true, orderTotal: true,
        currency: true, status: true, completedAt: true },
    });
    if (!order || order.merchantId !== snap.merchantId || order.sessionId !== snap.sessionId ||
      order.externalOrderId !== snap.providerPaymentId || order.currency !== snap.currency ||
      !["approved", "paid", "processing", "shipped", "delivered"].includes(order.status) ||
      !(order.completedAt instanceof Date) || !Number.isFinite(order.completedAt.getTime())) return undefined;
    const expectedCents = orderTotalCents(snap.amountBreakdown, snap.amountCents);
    if (!new Prisma.Decimal(String(order.orderTotal)).mul(100).equals(expectedCents)) return undefined;
    return order.externalOrderId;
  }
}
