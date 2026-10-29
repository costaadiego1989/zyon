import type {
  AuthorizedOffer,
  Cart,
  CheckoutSession,
  CompleteOrderRequest,
  MerchantRules,
  StartCheckoutRequest
} from "@zyon/shared-types";
import type { CheckoutCommercialMutation, CheckoutSessionRepository } from "../domain/ports/checkout-session.repository.port.js";
import { prepareCommercialMutation } from "../domain/services/checkout-commercial-mutation.js";

/** Test-only bridge for ACP's stub repositories. Reuse real invalidation rules;
 * this does not simulate database transactions, CAS, locks or durable outbox. */
export async function simulateCommercialMutation(
  repository: Pick<CheckoutSessionRepository, "saveSession" | "recordEvent">,
  input: CheckoutCommercialMutation,
): Promise<CheckoutSession> {
  const { session } = prepareCommercialMutation(input);
  await repository.saveSession(session);
  if (input.cancel) await repository.recordEvent(session.merchantId, session.sessionId, "checkout_abandoned", {
    source: "acp.protocol", reason: "buyer_initiated",
  });
  return session;
}

export function testCart(overrides: Partial<Cart> = {}): Cart {
  return {
    currency: "BRL",
    total: 300,
    items: [{ sku: "kit", name: "Kit", price: 300, cost: 120, quantity: 1 }],
    ...overrides
  };
}

export function startCheckoutRequest(overrides: Partial<StartCheckoutRequest> = {}): StartCheckoutRequest {
  return {
    merchant_id: "mrc_1",
    cart: testCart(),
    customer: { email: "Buyer@Example.com" },
    shipping: { customerPrice: 35, realCost: 37, region: "SP" },
    ...overrides
  };
}

export function checkoutSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  const now = "2026-05-01T12:00:00.000Z";
  return {
    merchantId: "mrc_1",
    sessionId: "chk_1",
    globalUserId: "usr_1",
    conversationId: "conv_1",
    cart: testCart(),
    customer: { email: "buyer@example.com" },
    shipping: { customerPrice: 35, realCost: 37, region: "SP" },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function authorizedOffer(overrides: Partial<AuthorizedOffer> = {}): AuthorizedOffer {
  return {
    id: "off_1",
    merchantId: "mrc_1",
    sessionId: "chk_1",
    type: "discount_percent",
    value: 10,
    approved: true,
    reason: "discount_allowed",
    marginAfterOffer: 0.5,
    expiresAt: "2999-01-01T00:00:00.000Z",
    discountCode: "AI-CHK1",
    ...overrides
  };
}

export function completeOrderRequest(overrides: Partial<CompleteOrderRequest> = {}): CompleteOrderRequest {
  return {
    merchant_id: "mrc_1",
    session_id: "chk_1",
    external_order_id: "ord_1",
    order_total: 300,
    currency: "BRL",
    ...overrides
  };
}

export function merchantRules(overrides: Partial<MerchantRules> = {}): MerchantRules {
  return {
    maxDiscountPercent: 10,
    minimumMarginPercent: 38,
    allowFreeShipping: true,
    allowShippingDiscount: true,
    allowBonusItem: false,
    allowStackDiscountAndFreeShipping: false,
    freeShippingMinCartValue: 250,
    maxShippingSubsidy: 45,
    maxPartialShippingDiscount: 20,
    offerExpirationMinutes: 15,
    blockedRegions: [],
    brandVoice: "consultative",
    couponBoxEnabled: true,
    autonomousEngineEnabled: true,
    ...overrides
  };
}
