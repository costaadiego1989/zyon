import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";

/** Synthetic journal data only; not an issuer or a persisted admission. */
export function widgetPaymentAuthorityFixture() {
  const cart = { currency: "BRL" as const, currentDiscount: 0 as const, total: 118, items: [
    { sku: "TRIGGER", variantId: "trigger", product_id: "trigger-product", name: "Synthetic trigger", productType: "physical" as const,
      quantity: 1, price: 100, variant: '["trigger",[]]' },
    { sku: "TARGET", variantId: "target", product_id: "target-product", name: "Synthetic target", productType: "physical" as const,
      quantity: 1, price: 18, originalPrice: 20, variant: '["target",[]]' },
  ], discountBudget: { version: 1 as const, originalSubtotalCents: 12000, promotionDiscountCents: 200 } };
  const shipping = { customerPrice: 9, carrier: "own:flat", method: "Synthetic delivery", deliveryDays: 1,
    destinationZip: "01310100", region: "SP" };
  const basisHash = paymentCartFingerprint({ cart, shipping });
  const amountBreakdown = { version: 1 as const, currency: "BRL" as const, cartFingerprint: basisHash, itemsSubtotalCents: 11800,
    discountCents: 0 as const, shippingCents: 900, platformFeeCents: 149, totalCents: 12849 };
  const authority = { version: 1 as const, origin: "widget_checkout" as const, paymentId: "payment", merchantId: "merchant",
    checkoutSessionId: "checkout", buyerId: "buyer", acceptanceEventId: "acceptance", checkoutVersion: 9,
    revisionEventId: "revision", contextHash: "a".repeat(64), basisHash, method: "pix" as const, currency: "BRL" as const,
    amountCents: 12849, admittedAt: "2026-10-20T12:00:00.000Z", amountBreakdown,
    frozenProjection: { globalUserId: "buyer", cart, shipping, customer: { fullName: "Synthetic Buyer", email: "buyer@example.test",
      cpf: "12345678901", phone: "11987654321", email_verified: true as const, address_verified: true as const,
      address: { zip: "01310100", street: "Synthetic Street", number: "10", complement: "", neighborhood: "Synthetic District", city: "Synthetic City", state: "SP" } } } };
  const input = { merchantId: "merchant", sessionId: "checkout", intentId: "payment", amountCents: 12849, currency: "BRL", method: "pix" };
  const scope = { id: "payment", merchantId: "merchant", sessionId: "checkout", amountCents: 12849, currency: "BRL", method: "pix",
    amountBreakdown, creation: { state: "ready", input, widgetCheckoutAuthority: authority } };
  return { authority, scope };
}
