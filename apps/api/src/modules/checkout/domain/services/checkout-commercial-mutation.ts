import type { CheckoutSession, CustomerAddress } from "@zyon/shared-types";
import type { CheckoutCommercialMutation } from "../ports/checkout-session.repository.port.js";
import { createCheckoutEventEnvelope } from "../events/checkout-domain-event.js";

const text = (value: string | undefined) => value?.trim() ?? "";
const digits = (value: string | undefined) => text(value).replace(/\D/g, "");
function addressKey(address?: CustomerAddress) {
  return JSON.stringify([digits(address?.zip), text(address?.state).toUpperCase(), text(address?.city),
    text(address?.street), text(address?.number), text(address?.neighborhood), text(address?.complement)]);
}
function buyerKey(session: CheckoutSession) {
  return JSON.stringify([session.globalUserId, text(session.customer?.email).toLowerCase(),
    digits(session.customer?.phone), digits(session.customer?.cpf)]);
}

/** Only removes invalidated authority. It never grants or recalculates a benefit. */
export function prepareCommercialMutation(input: CheckoutCommercialMutation) {
  const { expected } = input;
  const next = structuredClone(input.next);
  if (expected.merchantId !== next.merchantId || expected.sessionId !== next.sessionId) {
    throw new Error("CHECKOUT_COMMERCIAL_SCOPE_CONFLICT");
  }
  if (input.cancel) {
    next.cart = { ...next.cart, items: [], total: 0 };
    next.crossStoreItems = [];
  }
  const cartKey = (s: CheckoutSession) => JSON.stringify([s.cart.currency, s.cart.total, s.cart.items, s.crossStoreItems ?? []]);
  const cartChanged = cartKey(expected) !== cartKey(next);
  const addressChanged = addressKey(expected.customer?.address) !== addressKey(next.customer?.address);
  const buyerChanged = buyerKey(expected) !== buyerKey(next);
  const shippingChanged = JSON.stringify(expected.shipping ?? null) !== JSON.stringify(next.shipping ?? null);
  const invalidated = !!input.cancel || cartChanged || addressChanged || buyerChanged || shippingChanged;
  if (!invalidated && ((next.cart.currentDiscount ?? 0) !== (expected.cart.currentDiscount ?? 0)
    || JSON.stringify(next.cart.commercialNudge ?? null) !== JSON.stringify(expected.cart.commercialNudge ?? null))) {
    throw new Error("CHECKOUT_COMMERCIAL_BENEFIT_WRITE_FORBIDDEN");
  }
  if (shippingChanged && !cartChanged && !addressChanged && !buyerChanged && !input.cancel && next.shipping
    && !expected.shippingOptions?.some(option => JSON.stringify(option) === JSON.stringify(next.shipping))) {
    throw new Error("CHECKOUT_SHIPPING_OPTION_CHANGED");
  }
  if (invalidated) {
    next.cart.currentDiscount = 0;
    delete next.cart.commercialNudge;
    delete next.cart.appliedBenefits;
    // A retained discounted quote cannot become the new undiscounted price.
    if (input.cancel || cartChanged || addressChanged || buyerChanged) {
      delete next.shipping;
      delete next.shippingOptions;
    }
  }
  next.updatedAt = new Date().toISOString();
  const event = cartChanged ? createCheckoutEventEnvelope({ eventType: "checkout.cart.updated", merchantId: next.merchantId,
    causationId: next.sessionId, payload: { session_id: next.sessionId, currency: next.cart.currency,
      total: next.cart.total, item_count: next.cart.items.reduce((sum, item) => sum + item.quantity, 0) } }) : undefined;
  return { session: next, invalidated, event };
}
