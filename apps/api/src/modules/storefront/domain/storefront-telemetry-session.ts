/** Server-owned placeholder for conversation funnel events, never a checkout quote. */
export const STOREFRONT_TELEMETRY_CART = Object.freeze({ __storefront_telemetry: true, version: 1 });

export function isStorefrontTelemetrySession(value: unknown, merchantId: string, cartRef: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, any>;
  const cart = row.cart;
  return row.merchantId === merchantId && row.sessionId === cartRef &&
    row.conversationId === cartRef && row.globalUserId === cartRef &&
    cart !== null && typeof cart === 'object' && !Array.isArray(cart) &&
    Object.keys(cart).length === 2 && cart.__storefront_telemetry === true && cart.version === 1 &&
    row.customer === null && row.shipping === null && row.shippingOptions === null &&
    row.abandonmentScore === 0 && row.triggerAgent === false &&
    Array.isArray(row.chatHistory) && row.chatHistory.length === 0 &&
    row.promptVariantId === null && row.cohort === null && row.featuresApplied === null &&
    row.aiCostCents === 0 && row.version === 0 &&
    row._count?.authorizedOffers === 0 && row._count?.acceptedOffers === 0 && row._count?.completedOrders === 0;
}
