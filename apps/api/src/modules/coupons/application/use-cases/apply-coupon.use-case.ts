import { Injectable, Inject, Optional, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { authorizeShippingDiscount } from "@zyon/shipping-engine";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { COUPON_TRANSACTION_REPOSITORY, type CouponTransactionRepository } from "../../domain/ports/coupon-transaction-repository.port.js";
import { CouponRedemptionEntity, type RedemptionSource } from "../../domain/entities/coupon-redemption.entity.js";
import { validateCoupon } from "../../domain/policies/coupon-validity.policy.js";
import { calculateCouponDiscount, calculateShippingDiscount } from "../../domain/policies/coupon-discount-calculator.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { DISCOUNT_RULES_ENGINE, type DiscountRulesEnginePort } from "../../domain/ports/discount-rules-engine.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { PrismaCheckoutRepository } from "../../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaCouponRepository } from "../../infrastructure/repositories/prisma-coupon.repository.js";
import { PrismaCouponTransactionRepository } from "../../infrastructure/repositories/prisma-coupon-transaction.repository.js";
import { checkoutWithCoupon } from "../services/checkout-coupon.js";

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

export type CheckoutCouponInput = {
  merchant_id: string; session_id: string; code: string; expectedVersion: number | undefined;
};

@Injectable()
export class ApplyCouponUseCase {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(COUPON_TRANSACTION_REPOSITORY) private readonly transactions: CouponTransactionRepository,
    @Inject(DISCOUNT_RULES_ENGINE) private readonly discountEngine: DiscountRulesEnginePort,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  /** Checkout callers supply only scope, code and their server-read version.
   * All commercial inputs are read again under locks; no provider I/O here. */
  async executeForCheckout(input: CheckoutCouponInput) {
    if (!this.prisma) throw new Error("CHECKOUT_COUPON_PERSISTENCE_UNAVAILABLE");
    const frozen = structuredClone(input);
    return this.prisma.$transaction(tx => this.executeForCheckoutInTransaction(tx, frozen));
  }

  /** Internal composition only: the caller owns commit/rollback and must acquire
   * configuration locks before any session lock. Never starts a nested transaction. */
  async executeForCheckoutInTransaction(tx: Prisma.TransactionClient, input: CheckoutCouponInput) {
    // Configuration before session before coupon. Matches strategy publication.
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchant_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${input.merchant_id} FOR UPDATE`;
    if (!await tx.merchantRule.findUnique({ where: { merchantId: input.merchant_id } })) {
      throw new ConflictException("CHECKOUT_MERCHANT_RULES_UNAVAILABLE");
    }
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${input.merchant_id}
      AND session_id = ${input.session_id} FOR UPDATE`;
    const sessions = new PrismaCheckoutRepository(tx, true);
    const session = await sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== session.persistenceVersion) {
      throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
    }
    if (!session.cart.items.length || await tx.completedOrder.findFirst({
      where: { merchantId: input.merchant_id, sessionId: input.session_id }, select: { id: true },
    })) throw new ConflictException("CHECKOUT_COUPON_SESSION_NOT_MUTABLE");
    const code = input.code.toUpperCase().trim();
    await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id = ${input.merchant_id} AND code = ${code} FOR UPDATE`;
    const coupons = new PrismaCouponRepository(tx);
    const coupon = await coupons.findByCode(input.merchant_id, code);
    if (!coupon) throw new NotFoundException("COUPON_NOT_FOUND");
    const region = session.customer?.address?.state?.trim().toUpperCase();
    const snap = coupon.snapshot();
    if (!region && (snap.allowed_regions.length || snap.blocked_regions.length)) {
      throw new BadRequestException("COUPON_BUYER_REGION_REQUIRED");
    }
    if (snap.max_per_buyer !== null && !session.globalUserId?.trim()) {
      throw new BadRequestException("COUPON_BUYER_IDENTITY_REQUIRED");
    }
    const rules = await sessions.getRules(input.merchant_id);
    const applied = await tx.couponRedemption.findFirst({ where: {
      merchantId: input.merchant_id, sessionId: input.session_id, status: { not: "cancelled" },
    }, select: { id: true } });
    const scoped = new ApplyCouponUseCase(coupons, new PrismaCouponTransactionRepository(tx, true), this.discountEngine);
    const result = await scoped.execute({
      merchant_id: input.merchant_id, session_id: input.session_id, code,
      cart: session.cart, merchantRules: rules, shipping: session.shipping,
      buyer_global_user_id: session.globalUserId?.trim() || undefined, buyer_region: region,
      has_existing_commercial_benefit: !!applied || !!session.cart.commercialNudge || (session.cart.currentDiscount ?? 0) > 0,
      source: "manual",
    });
    const next = checkoutWithCoupon(session, result);
    await sessions.saveSession(next);
    if (!await tx.checkoutEvent.findFirst({ where: { merchantId: input.merchant_id,
      sessionId: input.session_id, eventName: "coupon_applied" }, select: { id: true } })) {
      await tx.checkoutEvent.create({ data: { merchantId: input.merchant_id,
        sessionId: input.session_id, eventName: "coupon_applied", occurredAt: new Date() } });
    }
    return { result, session: next, rules };
  }

  async execute(input: ApplyCouponInput) {
    const coupon = await this.coupons.findByCode(input.merchant_id, input.code.toUpperCase().trim());
    if (!coupon) throw new NotFoundException("COUPON_NOT_FOUND");

    const snap = coupon.snapshot();
    const validity = validateCoupon(snap, input.cart, input.buyer_region);
    if (!validity.valid) throw new BadRequestException(validity.reason);

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
      const shippingAuthorization = authorizeShippingDiscount({
        cart: input.cart, rules: input.merchantRules, shipping: input.shipping,
        requestedDiscount: shippingDiscountApplied,
        type: snap.discount_type === "shipping_free" ? "shipping_free" : "shipping_discount_fixed",
      });
      if (!shippingAuthorization.approved) {
        throw new UnprocessableEntityException(`COUPON_DISCOUNT_REJECTED:${shippingAuthorization.reason}`);
      }
      shippingDiscountApplied = shippingAuthorization.value;
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
