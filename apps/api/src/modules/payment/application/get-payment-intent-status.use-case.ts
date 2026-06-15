import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";

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
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository) {}

  async execute(input: GetPaymentIntentStatusRequest): Promise<GetPaymentIntentStatusResponse> {
    const merchantId = input.merchant_id.trim();
    const sessionId = input.session_id.trim();
    const intentId = input.intent_id.trim();
    if (!merchantId || !sessionId || !intentId) {
      throw new BadRequestException("payment_status_fields_required");
    }

    const intentRow = await this.payments.getIntentById(intentId);
    if (!intentRow) throw new NotFoundException("payment_intent_not_found");

    const snap = intentRow.snapshot();
    // Tenant + session boundary: never leak another merchant's/session's intent.
    if (snap.merchantId !== merchantId || snap.sessionId !== sessionId) {
      throw new NotFoundException("payment_intent_not_found");
    }

    // Order/receipt are real references the buyer can trust at confirmation:
    // the linked commerce order (or provider charge) and the provider invoice URL.
    return {
      intent_id: intentId,
      status: snap.status,
      amount_cents: snap.amountCents,
      approved_amount_cents: snap.approvedAmountCents,
      currency: snap.currency,
      method: snap.method,
      order_id: snap.commerceOrderId ?? snap.providerPaymentId,
      provider_payment_id: snap.providerPaymentId,
      receipt_url: snap.buyerFacing?.invoiceUrl
    };
  }
}
