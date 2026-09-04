import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException , Logger} from "@nestjs/common";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { COUPON_REDEMPTION_REPOSITORY, type CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";
import { CouponRedemptionEntity, type RedemptionSource } from "../../domain/entities/coupon-redemption.entity.js";
import { validateCoupon } from "../../domain/policies/coupon-validity.policy.js";
import { checkCouponLimits } from "../../domain/policies/coupon-limit.policy.js";
import { calculateCouponDiscount } from "../../domain/policies/coupon-discount-calculator.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { DISCOUNT_RULES_ENGINE, type DiscountRulesEnginePort } from "../../domain/ports/discount-rules-engine.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export type ApplyCouponInput = {
  merchant_id: string;
  session_id: string;
  code: string;
  cart: Cart;
  /** Merchant rules from the rules-engine — required to authorize the discount */
  merchantRules: MerchantRules;
  buyer_global_user_id?: string;
  buyer_region?: string;
  source?: RedemptionSource;
};

@Injectable()
export class ApplyCouponUseCase {
  private readonly logger = new Logger(ApplyCouponUseCase.name);

  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(COUPON_REDEMPTION_REPOSITORY) private readonly redemptions: CouponRedemptionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DISCOUNT_RULES_ENGINE) private readonly discountEngine: DiscountRulesEnginePort
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

    // P1 fix: count applied + redeemed (countByCoupon now excludes only cancelled)
    const globalCount = await this.redemptions.countByCoupon(coupon.id);
    const buyerCount = input.buyer_global_user_id
      ? await this.redemptions.countByBuyer(coupon.id, input.buyer_global_user_id)
      : 0;

    const limitCheck = checkCouponLimits(snap, globalCount, buyerCount);
    if (!limitCheck.allowed) throw new BadRequestException(limitCheck.reason);

    // MARKETPLACE GUARD: cross-store items never receive coupons or discounts.
    // Host merchant cannot subsidize another seller's product margin.
    if (input.cart?.items?.length === 0 && (input.cart as any).crossStoreItems?.length > 0) {
      throw new BadRequestException("marketplace_items_no_coupons");
    }

    // P0 fix: raw calculated discount must be authorized by the rules-engine
    // before persisting — enforces maxDiscountPercent and minimumMarginPercent.
    // Shipping-type coupons skip cart discount authorization (applied to freight).
    const isShippingCoupon = snap.discount_type.startsWith("shipping_");
    const rawDiscount = calculateCouponDiscount(snap, input.cart.total);

    let discountApplied: number;
    if (isShippingCoupon) {
      // Shipping coupons don't reduce cart total — discount is applied to shipping cost
      discountApplied = 0;
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

    // P1 fix: Race condition — wrap save in try/catch to detect concurrent applies.
    // If unique constraint fails (duplicate redemption on same session), return error.
    // This handles the case where two concurrent requests both pass limit checks.
    try {
      await this.redemptions.save(redemption);
    } catch (e: unknown) {
      const err = e as any;
      // P2002 is Prisma unique constraint violation
      if (err?.code === "P2002" && err?.meta?.target?.includes("session_id")) {
        throw new ConflictException("COUPON_ALREADY_APPLIED_CONCURRENT");
      }
      throw e;
    }

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
