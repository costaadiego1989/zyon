import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { Cart } from "@zyon/shared-types";
import { PRODUCT_PROMOTION_REPOSITORY, type ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import { resolveEffectiveUnitPrice, type ActivePromotion } from "../../../catalog/domain/services/product-price-resolver.service.js";

/**
 * Resolves effective unit prices for cart line items by looking up active
 * product promotions. Mutates cart items in-place to apply promo-adjusted prices.
 *
 * Merchant-scoped: promo lookup is always filtered by merchantId.
 * Graceful degradation: if promo repository is unavailable, returns unchanged cart.
 */
@Injectable()
export class CartPromoResolutionService {
  private readonly logger = new Logger(CartPromoResolutionService.name);

  constructor(
    @Optional() @Inject(PRODUCT_PROMOTION_REPOSITORY) private readonly promoRepo?: ProductPromotionRepositoryPort
  ) {}

  /**
   * Resolve promo prices for all cart items in-place.
   * Returns the mutated cart with each item's price set to its effective (promo-adjusted) price.
   */
  async resolveCartPromos(cart: Cart, merchantId: string, now?: Date): Promise<Cart> {
    if (!this.promoRepo || !cart.items || cart.items.length === 0) {
      return cart;
    }

    try {
      const mutatedCart = { ...cart };
      const mutatedItems = await Promise.all(
        cart.items.map(async (item) => {
          // Look up active promos for this cart line by SKU. CartItem carries
          // sku but not stable productId/variantId, so we resolve through the
          // repo's SKU-aware lookup which joins to variant + product.
          const promos = await this.promoRepo!.findActiveBySku(merchantId, item.sku, now);

          if (!promos || promos.length === 0) {
            // No promo: keep item unchanged
            return item;
          }

          // Take the first active promo (if multiple, merchant should ensure only one is active)
          const promo = promos[0]!;
          const descriptor = promo.couponId
            ? ({ kind: "coupon", couponId: promo.couponId } as ActivePromotion)
            : promo.discountType === "percent"
            ? ({ kind: "inline_percent", percent: promo.discountValue ?? 0 } as ActivePromotion)
            : promo.discountType === "fixed"
            ? ({ kind: "inline_fixed", amountCents: promo.discountValue ?? 0 } as ActivePromotion)
            : promo.promoPriceInCents != null
            ? ({ kind: "inline_price", promoPriceCents: promo.promoPriceInCents } as ActivePromotion)
            : undefined;

          if (!descriptor) {
            this.logger.warn(`Promo ${promo.id} has no valid descriptor`, { merchantId });
            return item;
          }

          // Resolve effective price (cents → reais for logging/inspection)
          const basePriceCents = Math.round(item.price * 100);
          const resolved = resolveEffectiveUnitPrice(basePriceCents, descriptor);

          // Convert resolved cents back to reais and apply to item
          return {
            ...item,
            price: resolved.unitPriceCents / 100,
          };
        })
      );

      mutatedCart.items = mutatedItems;
      return mutatedCart;
    } catch (err) {
      this.logger.error(
        `Cart promo resolution failed (non-critical, cart unchanged): ${err instanceof Error ? err.message : String(err)}`,
        { merchantId }
      );
      return cart;
    }
  }
}
