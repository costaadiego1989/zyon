import { createCheckoutEventEnvelope } from "../../../checkout/domain/events/checkout-domain-event.js";
import type { PaymentIntentEntity } from "../../domain/payment-intent.entity.js";
import type { PaymentRepository } from "../../domain/ports/payment-repository.port.js";

export async function savePaymentTransition(payments: PaymentRepository, intent: PaymentIntentEntity, reason?: string): Promise<void> {
  const snapshot = intent.snapshot();
  const event = createCheckoutEventEnvelope({ eventType: "payment.status.changed", merchantId: snapshot.merchantId,
    payload: { session_id: snapshot.sessionId, payment_intent_id: snapshot.id, status: snapshot.status,
      amount_cents: snapshot.amountCents, method: snapshot.method, commerce_order_id: snapshot.commerceOrderId, reason }, causationId: snapshot.id });
  await payments.saveIntentWithOutbox({ intent }, event);
}
