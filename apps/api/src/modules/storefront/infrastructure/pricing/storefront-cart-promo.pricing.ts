import { resolveEffectiveUnitPrice, type ActivePromotion } from "../../../catalog/domain/services/product-price-resolver.service.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";

/** Per-line promo badge metadata, keyed by variantId, for response DTOs. */
export type ProductPromoMeta = Map<string, { originalPriceCents: number; discountPercent?: number; coupon?: boolean }>;

/**
 * Apply active product promotions to a storefront cart's line prices IN-PLACE
 * and return badge metadata. Shared by the conversational tool-handler and the
 * REST cart controller so both surfaces price identically.
 *
 * Idempotent: the passed cart is always freshly read from the DB, whose
 * item.unitPriceCents is the ORIGINAL (base) price, so the promo is computed
 * from the base every call and never compounds. Coupon-linked promos leave the
 * price unchanged (badge only) — no fabricated discount.
 */
export async function applyProductPromoPricing(
  promoRepo: ProductPromotionRepositoryPort | undefined,
  merchantId: string,
  cart: StorefrontCart,
): Promise<ProductPromoMeta> {
  const meta: ProductPromoMeta = new Map();
  if (!promoRepo) return meta;
  for (const item of cart.items) {
    try {
      const promos = await promoRepo.findActiveBySku(merchantId, item.sku ?? item.variantId);
      if (promos.length === 0) continue;
      const promo = promos[0];
      let activePromo: ActivePromotion | undefined;
      if (promo.couponId) {
        activePromo = { kind: "coupon", couponId: promo.couponId };
      } else if (promo.discountType === "percent" && promo.discountValue != null) {
        activePromo = { kind: "inline_percent", percent: promo.discountValue };
      } else if (promo.discountType === "fixed" && promo.discountValue != null) {
        activePromo = { kind: "inline_fixed", amountCents: promo.discountValue };
      } else if (promo.promoPriceInCents != null) {
        activePromo = { kind: "inline_price", promoPriceCents: promo.promoPriceInCents };
      }
      if (!activePromo) continue;
      const resolved = resolveEffectiveUnitPrice(item.unitPriceCents, activePromo);
      if (activePromo.kind === "coupon") {
        meta.set(item.variantId, { originalPriceCents: item.unitPriceCents, coupon: true });
      } else if (resolved.unitPriceCents !== item.unitPriceCents) {
        meta.set(item.variantId, { originalPriceCents: item.unitPriceCents, discountPercent: resolved.discountPercent });
        item.unitPriceCents = resolved.unitPriceCents;
      }
    } catch {
      // Non-critical: leave the line at its original price if lookup fails.
    }
  }
  cart.total = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  return meta;
}
