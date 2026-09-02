/**
 * Product price resolver (pure domain service).
 *
 * Single authority for a cart line's effective unit price given an active
 * product promotion. Reused by storefront cart + checkout so pricing is
 * identical end-to-end.
 *
 * Invariant: a coupon-linked promotion NEVER reduces the unit price here.
 * The product coupon flag alone grants nothing — the actual discount is
 * applied at cart time via ApplyCoupon and capped by the rules-engine.
 * This upholds the "no fabricated discount" invariant.
 */

export type ActivePromotion =
  | { kind: "inline_percent"; percent: number }
  | { kind: "inline_fixed"; amountCents: number }
  | { kind: "inline_price"; promoPriceCents: number }
  | { kind: "coupon"; couponId: string };

export interface ResolvedPrice {
  unitPriceCents: number;
  originalPriceCents?: number;
  discountPercent?: number;
  couponBadge?: { couponId: string };
}

function discountPercentFrom(basePriceCents: number, unitPriceCents: number): number {
  if (basePriceCents <= 0) return 0;
  return Math.round((1 - unitPriceCents / basePriceCents) * 100);
}

export function resolveEffectiveUnitPrice(
  basePriceCents: number,
  promo?: ActivePromotion,
): ResolvedPrice {
  if (!promo) {
    return { unitPriceCents: basePriceCents };
  }

  switch (promo.kind) {
    case "inline_percent": {
      const unitPriceCents = Math.max(
        0,
        Math.round(basePriceCents * (1 - promo.percent / 100)),
      );
      return {
        unitPriceCents,
        originalPriceCents: basePriceCents,
        discountPercent: promo.percent,
      };
    }
    case "inline_fixed": {
      const unitPriceCents = Math.max(0, basePriceCents - promo.amountCents);
      return {
        unitPriceCents,
        originalPriceCents: basePriceCents,
        discountPercent: discountPercentFrom(basePriceCents, unitPriceCents),
      };
    }
    case "inline_price": {
      const unitPriceCents = Math.max(0, promo.promoPriceCents);
      return {
        unitPriceCents,
        originalPriceCents: basePriceCents,
        discountPercent: discountPercentFrom(basePriceCents, unitPriceCents),
      };
    }
    case "coupon": {
      // Badge only — no price change. See invariant note above.
      return {
        unitPriceCents: basePriceCents,
        couponBadge: { couponId: promo.couponId },
      };
    }
  }
}
