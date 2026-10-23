import { widgetPaymentAuthorityFixture } from "./widget-checkout-payment.fixture.js";
import type { NormalCheckoutPaymentAuthority } from "./normal-checkout-payment-authority.schemas.js";

/** Synthetic data for source tests, never an issuer or persisted proof. */
export function normalPaymentAuthorityFixture() {
  const f = widgetPaymentAuthorityFixture();
  const { acceptanceEventId: _event, revisionEventId: _revision, ...base } = f.authority;
  const authority:NormalCheckoutPaymentAuthority = { ...base, origin: "normal_checkout_cross_sell" as const,
    strategyContextVersion: 4, acceptanceEventIds: ["normal-acceptance"],
    frozenProjection: { ...f.authority.frozenProjection, cart: { ...f.authority.frozenProjection.cart,
      items: f.authority.frozenProjection.cart.items.map(item => item.sku !== "TARGET" ? item : { ...item,
        crossSellIntent: { version: 1 as const, promotionId: "promo", promotionUpdatedAt: "2026-10-20T11:00:00.000Z",
          acceptedQuantity: 1, originalUnitPriceCents: 2000, maximumUnitPriceCents: 1800 } }) } } };
  const { widgetCheckoutAuthority: _widget, ...creation } = f.scope.creation;
  const scope = { ...f.scope, creation: { ...creation, normalCrossSellAuthority: authority } };
  return { authority, scope };
}
