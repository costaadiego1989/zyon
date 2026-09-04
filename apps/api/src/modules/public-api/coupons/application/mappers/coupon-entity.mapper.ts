export class CouponEntityMapper {
  static toResponse(coupon: any) {
    return {
      id: coupon.id,
      code: coupon.code,
      merchant_id: coupon.merchant_id,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      min_cart_total: coupon.min_cart_total,
      max_usages: coupon.max_usages,
      max_per_buyer: coupon.max_per_buyer,
      usages_count: coupon.usages_count,
      allowed_skus: coupon.allowed_skus ?? [],
      blocked_skus: coupon.blocked_skus ?? [],
      allowed_regions: coupon.allowed_regions ?? [],
      blocked_regions: coupon.blocked_regions ?? [],
      status: coupon.status,
      starts_at: coupon.starts_at,
      ends_at: coupon.ends_at,
      created_at: coupon.created_at,
      updated_at: coupon.updated_at,
    };
  }

  static toValidationResponse(valid: boolean, reason?: string, discount?: any) {
    if (!valid) {
      return {
        valid: false,
        reason,
      };
    }
    return {
      valid: true,
      discount_value: discount?.value ?? 0,
      discount_type: discount?.type,
    };
  }
}
