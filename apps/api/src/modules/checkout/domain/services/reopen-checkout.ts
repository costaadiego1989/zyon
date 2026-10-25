import type { CheckoutEditSection, CheckoutSession } from "@zyon/shared-types";

export function reopenCheckout(session: CheckoutSession, section: CheckoutEditSection): CheckoutSession {
  const next = structuredClone(session);
  delete next.paymentMethod;
  if (section === "address") {
    delete next.shipping;
    delete next.shippingOptions;
  } else if (section === "shipping") delete next.shipping;
  else if (next.shipping && next.cart.appliedBenefits?.some(benefit => benefit.kind === "shipping")) {
    const original = next.shippingOptions?.find(quote => quote.carrier === next.shipping!.carrier
      && quote.method === next.shipping!.method && quote.destinationZip === next.shipping!.destinationZip);
    next.shipping = original ? structuredClone(original) : undefined;
  }
  next.cart.currentDiscount = 0;
  delete next.cart.commercialNudge;
  delete next.cart.appliedBenefits;
  next.updatedAt = new Date().toISOString();
  return next;
}
