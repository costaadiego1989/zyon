export class CouponMerchantRequiredError extends Error {
  readonly code = "coupon_merchant_required";
  constructor() {
    super("coupon_merchant_required");
    this.name = "CouponMerchantRequiredError";
  }
}

export class CouponCodeRequiredError extends Error {
  readonly code = "coupon_code_required";
  constructor() {
    super("coupon_code_required");
    this.name = "CouponCodeRequiredError";
  }
}

export class CouponDiscountValueInvalidError extends Error {
  readonly code = "coupon_discount_value_invalid";
  constructor(value?: number) {
    super(value !== undefined ? `coupon_discount_value_invalid:${value}` : "coupon_discount_value_invalid");
    this.name = "CouponDiscountValueInvalidError";
  }
}

export class CouponNotFoundError extends Error {
  readonly code = "coupon_not_found";
  constructor(code?: string) {
    super(code ? `coupon_not_found:${code}` : "coupon_not_found");
    this.name = "CouponNotFoundError";
  }
}

export class CouponExpiredError extends Error {
  readonly code = "coupon_expired";
  constructor(code: string) {
    super(`coupon_expired:${code}`);
    this.name = "CouponExpiredError";
  }
}

export class CouponUsageLimitReachedError extends Error {
  readonly code = "coupon_usage_limit_reached";
  constructor(code: string, maxUsages: number) {
    super(`coupon_usage_limit_reached:${code}:${maxUsages}`);
    this.name = "CouponUsageLimitReachedError";
  }
}

export class CouponBuyerLimitReachedError extends Error {
  readonly code = "coupon_buyer_limit_reached";
  constructor(code: string, maxPerBuyer: number) {
    super(`coupon_buyer_limit_reached:${code}:${maxPerBuyer}`);
    this.name = "CouponBuyerLimitReachedError";
  }
}

export class CouponMinCartNotMetError extends Error {
  readonly code = "coupon_min_cart_not_met";
  constructor(code: string, minCartTotal: number, cartTotal: number) {
    super(`coupon_min_cart_not_met:${code}:min=${minCartTotal}:cart=${cartTotal}`);
    this.name = "CouponMinCartNotMetError";
  }
}

export class CouponNotYetActiveError extends Error {
  readonly code = "coupon_not_yet_active";
  constructor(code: string, startsAt: string) {
    super(`coupon_not_yet_active:${code}:starts=${startsAt}`);
    this.name = "CouponNotYetActiveError";
  }
}

export class CouponSkuBlockedError extends Error {
  readonly code = "coupon_sku_blocked";
  constructor(code: string) {
    super(`coupon_sku_blocked:${code}`);
    this.name = "CouponSkuBlockedError";
  }
}

export class CouponRegionBlockedError extends Error {
  readonly code = "coupon_region_blocked";
  constructor(code: string, region: string) {
    super(`coupon_region_blocked:${code}:${region}`);
    this.name = "CouponRegionBlockedError";
  }
}

export class CouponShippingMinCartNotMetError extends Error {
  readonly code = "coupon_shipping_min_cart_not_met";
  constructor(code: string, minCartTotal: number) {
    super(`coupon_shipping_min_cart_not_met:${code}:min=${minCartTotal}`);
    this.name = "CouponShippingMinCartNotMetError";
  }
}

export class CouponDiscountRejectedError extends Error {
  readonly code = "coupon_discount_rejected";
  constructor(reason: string) {
    super(`coupon_discount_rejected:${reason}`);
    this.name = "CouponDiscountRejectedError";
  }
}
