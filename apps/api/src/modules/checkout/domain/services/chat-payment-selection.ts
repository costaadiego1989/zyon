import type { ChatStage, PaymentMethod } from "@zyon/shared-types";

// Captured by the reviewed baseline. Text routes to the visual payment chooser;
// only its signed buyer action can select a method and create a payment intent.
export const CHECKOUT_PAYMENT_ROUTING_VERSION = "checkout-payment-routing-v3-signed-visual" as const;

/** Existing chat payment routing shared with the experimental effect boundary.
 * A match is a routing hint, not consent or authority to charge a buyer. */
export function chatPaymentSelection(message: string, stage: ChatStage, suppressed = false): PaymentMethod | undefined {
  if (stage !== "payment" || suppressed) return undefined;
  if (/\b(pix|qr code)\b/i.test(message)) return "pix";
  if (/\b(cartão|cartao|credito|crédito)\b/i.test(message)) return "credit_card";
  if (/\bboleto\b/i.test(message)) return "boleto";
  if (/\b(crypto|cripto|usdc|usdt|polygon|base|carteira|wallet|metamask)\b/i.test(message)) return "crypto";
  return undefined;
}
