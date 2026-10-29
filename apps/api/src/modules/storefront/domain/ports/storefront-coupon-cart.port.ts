import type { StorefrontCouponCartScope, StorefrontCouponCartInput, StorefrontCouponCartResult } from "../contracts/storefront-coupon-cart.schemas.js";
export const STOREFRONT_COUPON_CART = Symbol("STOREFRONT_COUPON_CART");
export interface StorefrontCouponCartPort {
  apply(scope: StorefrontCouponCartScope, input: StorefrontCouponCartInput): Promise<StorefrontCouponCartResult>;
}

