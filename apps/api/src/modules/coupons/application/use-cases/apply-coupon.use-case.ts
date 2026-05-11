import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import type { Cart } from "@aacp/shared-types";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { COUPON_REDEMPTION_REPOSITORY, type CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";
import { CouponRedemptionEntity, type RedemptionSource } from "../../domain/entities/coupon-redemption.entity.js";
import { validateCoupon } from "../../domain/policies/coupon-validity.policy.js";
import { checkCouponLimits } from "../../domain/policies/coupon-limit.policy.js";
import { calculateCouponDiscount } from "../../domain/policies/coupon-discount-calculator.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";

export type ApplyCouponInput = {
  merchant_id: string;
  session_id: string;
  code: string;
  cart: Cart;
  buyer_global_user_id?: string;
  buyer_region?: string;
  source?: RedemptionSource;
};

@Injectable()
export class ApplyCouponUseCase {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(COUPON_REDEMPTION_REPOSITORY) private readonly redemptions: CouponRedemptionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: ApplyCouponInput) {
    const coupon = await this.coupons.findByCode(input.merchant_id, input.code.toUpperCase().trim());
    if (!coupon) throw new NotFoundException("COUPON_NOT_FOUND");

    // Idempotency: reject duplicate apply on same session
    const existing = await this.redemptions.findBySession(input.session_id, input.merchant_id);
    if (existing.some((r) => r.coupon_id === coupon.id && r.status === "applied")) {
      throw new ConflictException("COUPON_ALREADY_APPLIED");
    }

    const snap = coupon.snapshot();
    const validity = validateCoupon(snap, input.cart, input.buyer_region);
    if (!validity.valid) throw new BadRequestException(validity.reason);

    const globalCount = await this.redemptions.countByCoupon(coupon.id);
    const buyerCount = input.buyer_global_user_id
      ? await this.redemptions.countByBuyer(coupon.id, input.buyer_global_user_id)
      : 0;

    const limitCheck = checkCouponLimits(snap, globalCount, buyerCount);
    if (!limitCheck.allowed) throw new BadRequestException(limitCheck.reason);

    const discountApplied = calculateCouponDiscount(snap, input.cart.total);

    const redemption = CouponRedemptionEntity.create({
      coupon_id: coupon.id,
      merchant_id: input.merchant_id,
      session_id: input.session_id,
      buyer_global_user_id: input.buyer_global_user_id ?? null,
      discount_applied: discountApplied,
      source: input.source ?? "manual"
    });

    await this.redemptions.save(redemption);

    await this.outbox.appendOutbox(
      createCouponEventEnvelope({
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
    );

    return { redemption_id: redemption.id, discount_applied: discountApplied, coupon: snap };
  }
}
