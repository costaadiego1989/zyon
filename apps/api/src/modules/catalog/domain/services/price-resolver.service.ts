/**
 * Price resolution with promotion support.
 *
 * Resolves effective price for a variant considering:
 * 1. Active variant-level promotion
 * 2. Active category-level promotion
 * 3. Conflict rule: BIGGEST discount wins
 */

export interface PromotionData {
  discountType: "percent" | "fixed";
  discountValue: number;
  isActive: boolean;
}

export interface PriceResolution {
  originalPriceCents: number;
  effectivePriceCents: number;
  isOnPromotion: boolean;
  discountPercent: number;
  discountAmountCents: number;
  appliedPromoType: "variant" | "category" | null;
}

export function resolveEffectivePrice(
  basePriceCents: number,
  variantPromo: PromotionData | null,
  categoryPromo: PromotionData | null
): PriceResolution {
  const noPromo: PriceResolution = {
    originalPriceCents: basePriceCents,
    effectivePriceCents: basePriceCents,
    isOnPromotion: false,
    discountPercent: 0,
    discountAmountCents: 0,
    appliedPromoType: null,
  };

  if (basePriceCents <= 0) return noPromo;

  const variantDiscount = computeDiscount(basePriceCents, variantPromo);
  const categoryDiscount = computeDiscount(basePriceCents, categoryPromo);

  // No active promos
  if (variantDiscount === 0 && categoryDiscount === 0) return noPromo;

  // Pick biggest discount
  const isVariantBigger = variantDiscount >= categoryDiscount;
  const discountCents = isVariantBigger ? variantDiscount : categoryDiscount;
  const effectivePrice = Math.max(0, basePriceCents - discountCents);
  const discountPercent = Math.round((discountCents / basePriceCents) * 100);

  return {
    originalPriceCents: basePriceCents,
    effectivePriceCents: effectivePrice,
    isOnPromotion: true,
    discountPercent,
    discountAmountCents: discountCents,
    appliedPromoType: isVariantBigger ? "variant" : "category",
  };
}

function computeDiscount(basePriceCents: number, promo: PromotionData | null): number {
  if (!promo || !promo.isActive) return 0;
  if (promo.discountType === "percent") {
    const capped = Math.min(promo.discountValue, 100);
    return Math.round((basePriceCents * capped) / 100);
  }
  // fixed: discount_value is in cents
  return Math.min(promo.discountValue, basePriceCents);
}
