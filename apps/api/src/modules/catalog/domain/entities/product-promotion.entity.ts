export interface ProductPromotionProps {
  id?: string;
  merchantId: string;
  productId?: string | null;
  variantId?: string | null;
  categoryId?: string | null;
  couponId?: string | null;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
  promoPriceInCents?: number | null;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date;
}

export type ProductPromotionDescriptor =
  | { kind: "inline_percent"; discountValue: number }
  | { kind: "inline_fixed"; discountValue: number }
  | { kind: "inline_price"; promoPriceInCents: number }
  | { kind: "coupon"; couponId: string };

export class ProductPromotionEntity {
  readonly id: string;
  readonly merchantId: string;
  readonly productId?: string | null;
  readonly variantId?: string | null;
  readonly categoryId?: string | null;
  readonly couponId?: string | null;
  readonly discountType?: "percent" | "fixed" | null;
  readonly discountValue?: number | null;
  readonly promoPriceInCents?: number | null;
  readonly isActive: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;

  private constructor(props: ProductPromotionProps & { id: string }) {
    this.id = props.id;
    this.merchantId = props.merchantId;
    this.productId = props.productId;
    this.variantId = props.variantId;
    this.categoryId = props.categoryId;
    this.couponId = props.couponId;
    this.discountType = props.discountType;
    this.discountValue = props.discountValue;
    this.promoPriceInCents = props.promoPriceInCents;
    this.isActive = props.isActive;
    this.startsAt = props.startsAt;
    this.endsAt = props.endsAt;
  }

  static create(props: ProductPromotionProps): ProductPromotionEntity {
    // Generate id if not provided
    const id = props.id || this.generateId();

    // Invariant 5: startsAt < endsAt
    if (props.startsAt >= props.endsAt) {
      throw new Error("promotion_invalid_window");
    }

    // Determine if we have inline discount or coupon-based
    const hasInlineDiscount =
      (props.discountType !== undefined && props.discountType !== null) ||
      (props.discountValue !== undefined && props.discountValue !== null) ||
      (props.promoPriceInCents !== undefined && props.promoPriceInCents !== null);

    const hasCoupon = props.couponId !== undefined && props.couponId !== null;

    // Invariant 1a: Both-set check
    if (hasCoupon && hasInlineDiscount) {
      throw new Error("promotion_inline_and_coupon_conflict");
    }

    // Invariant 1b: Neither-set check
    if (!hasCoupon && !hasInlineDiscount) {
      throw new Error("promotion_no_discount_source");
    }

    // Invariant 2: Percent bounds (0-100)
    if (props.discountType === "percent" && props.discountValue !== undefined && props.discountValue !== null) {
      if (props.discountValue < 0 || props.discountValue > 100) {
        throw new Error("promotion_percent_out_of_range");
      }
    }

    // Invariant 3: Fixed discount >= 0
    if (props.discountType === "fixed" && props.discountValue !== undefined && props.discountValue !== null) {
      if (props.discountValue < 0) {
        throw new Error("promotion_negative_discount");
      }
    }

    // Invariant 4: promoPriceInCents >= 0
    if (props.promoPriceInCents !== undefined && props.promoPriceInCents !== null) {
      if (props.promoPriceInCents < 0) {
        throw new Error("promotion_negative_price");
      }
    }

    return new ProductPromotionEntity({
      ...props,
      id,
    });
  }

  describe(): ProductPromotionDescriptor {
    if (this.couponId) {
      return {
        kind: "coupon",
        couponId: this.couponId,
      };
    }

    if (this.discountType === "percent" && this.discountValue !== undefined && this.discountValue !== null) {
      return {
        kind: "inline_percent",
        discountValue: this.discountValue,
      };
    }

    if (this.discountType === "fixed" && this.discountValue !== undefined && this.discountValue !== null) {
      return {
        kind: "inline_fixed",
        discountValue: this.discountValue,
      };
    }

    if (this.promoPriceInCents !== undefined && this.promoPriceInCents !== null) {
      return {
        kind: "inline_price",
        promoPriceInCents: this.promoPriceInCents,
      };
    }

    // Should not reach here due to invariant checks in create()
    throw new Error("promotion_unknown_descriptor");
  }

  private static generateId(): string {
    // Simple ID generation; replace with actual CUID if available
    return `promo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
