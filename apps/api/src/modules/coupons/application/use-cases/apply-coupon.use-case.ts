import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { COUPON_TRANSACTION_REPOSITORY, type CouponTransactionRepository } from "../../domain/ports/coupon-transaction-repository.port.js";
import { CouponRedemptionEntity, type RedemptionSource } from "../../domain/entities/coupon-redemption.entity.js";
import { validateCoupon } from "../../domain/policies/coupon-validity.policy.js";
import { calculateCouponDiscount, calculateShippingDiscount } from "../../domain/policies/coupon-discount-calculator.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { DISCOUNT_RULES_ENGINE, type DiscountRulesEnginePort } from "../../domain/ports/discount-rules-engine.port.js";

export type ApplyCouponInput = {
  merchant_id: string;
  session_id: string;
  code: string;
  cart: Cart;
  merchantRules: MerchantRules;
  buyer_global_user_id?: string;
  buyer_region?: string;
  /** Server-side quote; required when applying a shipping coupon. */
  shipping?: ShippingQuote;
  /** Server-derived state used to prevent stacking commercial benefits. */
  has_existing_commercial_benefit?: boolean;
  source?: RedemptionSource;
};

@Injectable()
export class ApplyCouponUseCase {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(COUPON_TRANSACTION_REPOSITORY) private readonly transactions: CouponTransactionRepository,
    @Inject(DISCOUNT_RULES_ENGINE) private readonly discountEngine: DiscountRulesEnginePort
  ) {}

  async execute(input: ApplyCouponInput) {
    const coupon = await this.coupons.findByCode(input.merchant_id, input.code.toUpperCase().trim());
    if (!coupon) throw new NotFoundException("COUPON_NOT_FOUND");

    const snap = coupon.snapshot();
    const validity = validateCoupon(snap, input.cart, input.buyer_region);
    if (validity.valid === false) throw new BadRequestException(validity.reason);

    if (input.has_existing_commercial_benefit) {
      throw new ConflictException("CHECKOUT_COMMERCIAL_BENEFIT_ALREADY_APPLIED");
    }

    if (input.cart?.items?.length === 0 && (input.cart as any).crossStoreItems?.length > 0) {
      throw new BadRequestException("marketplace_items_no_coupons");
    }

    const isShippingCoupon = snap.discount_type.startsWith("shipping_");
    const rawDiscount = calculateCouponDiscount(snap, input.cart.total);
    let discountApplied: number;
    let shippingDiscountApplied = 0;
    if (isShippingCoupon) {
      const shippingPrice = input.shipping?.customerPrice;
      if (typeof shippingPrice !== "number" || !Number.isFinite(shippingPrice) || shippingPrice < 0) {
        throw new BadRequestException("COUPON_SHIPPING_NOT_CALCULATED");
      }
      if (snap.discount_type === "shipping_free" && !input.merchantRules.allowFreeShipping) {
        throw new UnprocessableEntityException("COUPON_FREE_SHIPPING_NOT_ALLOWED");
      }
      if (snap.discount_type !== "shipping_free" && !input.merchantRules.allowShippingDiscount) {
        throw new UnprocessableEntityException("COUPON_SHIPPING_DISCOUNT_NOT_ALLOWED");
      }
      discountApplied = 0;
      shippingDiscountApplied = calculateShippingDiscount(snap, shippingPrice);
    } else {
      const authorization = this.discountEngine.authorizeDiscount(
        input.cart,
        input.merchantRules,
        snap.discount_type === "percent" ? snap.discount_value : rawDiscount,
        snap.discount_type as "percent" | "fixed"
      );
      if (!authorization.approved) {
        throw new UnprocessableEntityException(`COUPON_DISCOUNT_REJECTED:${authorization.reason}`);
      }
      discountApplied = snap.discount_type === "percent"
        ? calculateCouponDiscount({ ...snap, discount_value: authorization.authorizedDiscount }, input.cart.total)
        : Math.min(authorization.authorizedDiscount, input.cart.total);
    }

    const redemption = CouponRedemptionEntity.create({
      coupon_id: coupon.id,
      merchant_id: input.merchant_id,
      session_id: input.session_id,
      buyer_global_user_id: input.buyer_global_user_id ?? null,
      discount_applied: discountApplied,
      source: input.source ?? "manual"
    });
    const reservation = await this.transactions.reserve({
      coupon: snap,
      redemption,
      event: createCouponEventEnvelope({
        eventType: "coupon.applied",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          coupon_id: coupon.id,
          code: snap.code,
          discount_applied: discountApplied,
          source: redemption.snapshot().source
        }
      })
    });

    if (reservation.status === "coupon_missing") throw new NotFoundException("COUPON_NOT_FOUND");
    if (reservation.status === "already_applied") throw new ConflictException("COUPON_ALREADY_APPLIED");
    if (reservation.status === "limit_reached") throw new BadRequestException(reservation.reason);

    return {
      redemption_id: reservation.redemption_id ?? redemption.id,
      discount_applied: discountApplied,
      shipping_discount_applied: shippingDiscountApplied,
      coupon: snap,
    };
  }
}
