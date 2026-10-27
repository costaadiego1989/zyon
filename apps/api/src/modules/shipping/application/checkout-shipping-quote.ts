import type { CheckoutSession, ShippingQuote } from "@zyon/shared-types";
import { physicalDeliveryItems } from "../../checkout/domain/services/cart-fulfillment.js";
import type { QuoteShippingInput } from "./use-cases/quote-shipping.use-case.js";
import type { ShippingQuoteSnapshot, ShippingQuoteResult } from "../domain/entities/shipping-quote.entity.js";

export function checkoutShippingInput(session: CheckoutSession): QuoteShippingInput {
  const items = physicalDeliveryItems(session.cart);
  return {
    merchant_id: session.merchantId, session_id: session.sessionId,
    destination_zip: session.customer?.address?.zip ?? "",
    destination_neighborhood: session.customer?.address?.neighborhood,
    destination_city: session.customer?.address?.city,
    destination_state: session.customer?.address?.state,
    cart_total: session.cart.total,
    packages: items.map(item => ({ weightKg: item.weight_kg ?? (item.weightGrams ?? 0) / 1000,
      heightCm: item.height_cm ?? 0, widthCm: item.width_cm ?? 0, lengthCm: item.length_cm ?? 0,
      quantity: item.quantity })),
    items: items.map(item => ({ sku: item.sku, quantity: item.quantity })),
  };
}

export function checkoutShippingOption(quote: ShippingQuoteSnapshot, result: ShippingQuoteResult): ShippingQuote {
  return {
    customerPrice: result.price / 100, realCost: (result.real_cost ?? result.price) / 100,
    carrier: result.source === "own_delivery" ? "Entrega própria" : result.label.split(/\s+/)[0],
    carrierKey: result.carrier_key, method: result.label, deliveryDays: result.eta_days,
    destinationZip: quote.destination_zip, quoteId: quote.id, quoteKey: quote.quote_key,
    expiresAt: quote.expires_at, source: result.source,
    estimatedValue: result.estimated_value, estimatedUnit: result.estimated_unit,
  };
}
