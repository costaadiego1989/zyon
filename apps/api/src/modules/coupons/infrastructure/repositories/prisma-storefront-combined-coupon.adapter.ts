import type { PrismaClient } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { PrismaStorefrontCartUnitOfWork } from "../../../storefront/infrastructure/repositories/prisma-storefront-cart-unit-of-work.js";
import { lockCrossSellMerchantAuthority } from "../../../storefront/infrastructure/repositories/storefront-cross-sell-authority-fence.js";
import type { StorefrontCart } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { storefrontLocalCartCommercialOutcomeV1Schema } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { commercialNoticesSchema } from "../../../storefront/domain/contracts/commercial-notice.schemas.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import { FoodOptionValidationError } from "../../../storefront/domain/food-options.js";
import { combinedCouponReviewRequired, readCombinedCouponMerchandise, readCombinedStorefrontCouponCommercial } from "../../../../shared/persistence/storefront-coupon/combined-merchandise.js";
import { PrismaCouponRepository } from "./prisma-coupon.repository.js";
import { PrismaCouponTransactionRepository } from "./prisma-coupon-transaction.repository.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { calculateCouponDiscount } from "../../domain/policies/coupon-discount-calculator.js";
import { validateCoupon } from "../../domain/policies/coupon-validity.policy.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { mutateStorefrontCombinedCoupon, type CombinedCouponLifecycleRequest } from "./prisma-storefront-combined-coupon.lifecycle.js";

const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const scopeSchema = z.strictObject({ merchantId: ref, cartId: ref, trustedBuyerGlobalUserId: ref.optional() });
const requestSchema = z.strictObject({ code: z.string().trim().min(1).max(191)
  .refine(value => !value.includes("\0")).transform(value => value.toUpperCase()) });
const resultSchema = z.discriminatedUnion("applied", [
  z.strictObject({ applied: z.literal(false), reason: z.enum(["commercial_benefit_review_required", "discount_limit_reached", "coupon_limit_reached"]),
    commercialNotices: commercialNoticesSchema }),
  z.strictObject({ applied: z.literal(true), reason: z.literal("success"), couponCode: ref,
    discountCents: z.number().int().min(1).max(2_147_483_647), quote: storefrontLocalCartCommercialOutcomeV1Schema.shape.quote,
    commercialNotices: commercialNoticesSchema.optional() }),
]);
const knownCommercialErrors = new Set(["storefront_combined_coupon_review_required", "cross_sell_quote_review_required",
  "storefront_effect_catalog_authority_invalid", "storefront_effect_cart_scope_invalid", "storefront_effect_cart_authority_invalid",
  "storefront_effect_existing_price_or_product_changed", "storefront_effect_merchant_authority_invalid", "storefront_effect_rules_unsupported",
  "storefront_effect_commercial_authority_invalid", "product_promotion_window_invalid", "product_promotion_descriptor_ambiguous",
  "product_promotion_descriptor_invalid", "product_promotion_allocation_overflow"]);
type Result = z.output<typeof resultSchema>;
function declined(reason: "commercial_benefit_review_required" | "discount_limit_reached" | "coupon_limit_reached"): Result {
  return resultSchema.parse({ applied: false, reason, commercialNotices: [commercialNotice(reason === "discount_limit_reached"
    ? "discount_limit_reached" : "benefit_conditions_not_met")] });
}

/** Internal first-application composition. Reuses the existing V1 reservation,
 * outbox and cart writer in ONE UOW. Not a public grant or payment admission;
 * public reads/checkout/payment still require their own canonical integration. */
export class PrismaStorefrontCombinedCouponAdapter {
  constructor(private readonly prisma: PrismaClient) {}

  /** Explicit unbound lifecycle; never injected into a generic cart writer. */
  async mutate(rawScope: z.input<typeof scopeSchema>, rawInput: CombinedCouponLifecycleRequest) {
    return mutateStorefrontCombinedCoupon(this.prisma, scopeSchema.parse(rawScope), rawInput);
  }

  /** Scope-only canonical recovery/read; no caller price, reserve or quote and
   * no getOrCreate/upsert/TTL effect. A financial owner still uses admission. */
  async read(rawScope: z.input<typeof scopeSchema>): Promise<Result> {
    const { trustedBuyerGlobalUserId, ...scope } = scopeSchema.parse(rawScope);
    return new PrismaStorefrontCartUnitOfWork(this.prisma).run(scope, async ({ tx }) => {
      const row = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
      if (!row) return combinedCouponReviewRequired();
      const cart: StorefrontCart = { ...row, items: row.items as unknown as StorefrontCart["items"] };
      const outcome = await readCombinedStorefrontCouponCommercial(tx, scope, cart, trustedBuyerGlobalUserId);
      return resultSchema.parse({ applied: true, reason: "success", couponCode: cart.couponCode, discountCents: cart.discount,
        quote: outcome.quote, ...(outcome.quote.commercialNotices ? { commercialNotices: outcome.quote.commercialNotices } : {}) });
    }, { beforeCartLock: tx => lockCrossSellMerchantAuthority(tx, scope.merchantId) });
  }

  async apply(rawScope: z.input<typeof scopeSchema>, rawInput: z.input<typeof requestSchema>): Promise<Result> {
    // Snapshot before any await; buyer scope is server authentication, not body.
    const { trustedBuyerGlobalUserId, ...scope } = scopeSchema.parse(rawScope);
    const request = requestSchema.parse(rawInput);
    try {
      return await new PrismaStorefrontCartUnitOfWork(this.prisma).run(scope, async ({ tx, cart: bound }) => {
        const stored = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
        if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.cartId || stored.couponCode !== null
          || stored.discount !== 0 || stored.freeShipping !== false || !Array.isArray(stored.items)) return combinedCouponReviewRequired();
        const cart: StorefrontCart = { ...stored, items: stored.items as unknown as StorefrontCart["items"] };
        const active = await tx.couponRedemption.findMany({ where: { merchantId: scope.merchantId, sessionId: scope.cartId,
          status: { not: "cancelled" } }, take: 2 });
        if (active.length !== 0) return combinedCouponReviewRequired();
        const locked = z.array(z.strictObject({ id: ref })).length(1).parse(
          await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id=${scope.merchantId} AND code=${request.code} FOR UPDATE`);
        const entity = await new PrismaCouponRepository(tx).findByCode(scope.merchantId, request.code);
        if (!entity) return combinedCouponReviewRequired();
        const coupon = entity.snapshot();
        if (coupon.id !== locked[0]!.id || coupon.merchant_id !== scope.merchantId || coupon.code !== request.code
          || coupon.strategy_incentive_execution_id || !["fixed", "percent"].includes(coupon.discount_type)
          || coupon.allowed_regions.length || coupon.blocked_regions.length
          || coupon.max_per_buyer !== null && !trustedBuyerGlobalUserId) return combinedCouponReviewRequired();
        // No ABA/reactivation of a historical reservation through this first-only
        // slice. Existing dedicated release/reapply owns old generations.
        if (await tx.couponRedemption.findUnique({ where: { merchantId_sessionId_couponId: {
          merchantId: scope.merchantId, sessionId: scope.cartId, couponId: coupon.id } }, select: { id: true } })) return combinedCouponReviewRequired();
        const authority = await readCombinedCouponMerchandise(tx, scope, cart);
        if (!validateCoupon(coupon, authority.cart, undefined, authority.now).valid) return combinedCouponReviewRequired();
        const requested = moneyCents(calculateCouponDiscount(coupon, authority.cart.total));
        if (requested === null || requested <= 0) return combinedCouponReviewRequired();
        const decision = evaluateCombinedDiscount(authority.cart, authority.rules, requested);
        if (decision.kind !== "authorized") return combinedCouponReviewRequired();
        if (decision.cartDiscountCents <= 0) return declined("discount_limit_reached");
        const redemption = CouponRedemptionEntity.create({ coupon_id: coupon.id, merchant_id: scope.merchantId, session_id: scope.cartId,
          buyer_global_user_id: trustedBuyerGlobalUserId ?? null, discount_applied: decision.cartDiscountCents / 100, source: "manual" });
        const event = createCouponEventEnvelope({ eventType: "coupon.applied", merchantId: scope.merchantId,
          payload: { session_id: scope.cartId, coupon_id: coupon.id, code: coupon.code,
            discount_applied: decision.cartDiscountCents / 100, source: "manual" } });
        const reservation = await new PrismaCouponTransactionRepository(tx, true).reserve({ coupon, redemption,
          event: { ...event, occurred_at: authority.now.toISOString() } });
        if (reservation.status === "limit_reached") return declined("coupon_limit_reached");
        if (reservation.status !== "reserved" || reservation.redemption_id !== redemption.id) return combinedCouponReviewRequired();
        await bound.applyCoupon(scope.merchantId, scope.cartId, coupon.code, decision.cartDiscountCents, cart);
        const outcome = await readCombinedStorefrontCouponCommercial(tx, scope, { ...cart, couponCode: coupon.code, discount: decision.cartDiscountCents }, trustedBuyerGlobalUserId);
        return resultSchema.parse({ applied: true, reason: "success", couponCode: coupon.code, discountCents: decision.cartDiscountCents,
          quote: outcome.quote, ...(outcome.quote.commercialNotices ? { commercialNotices: outcome.quote.commercialNotices } : {}) });
      }, { beforeCartLock: tx => lockCrossSellMerchantAuthority(tx, scope.merchantId),
        revalidateCoupon: (tx, lockedScope, cart) => readCombinedStorefrontCouponCommercial(tx, lockedScope, cart, trustedBuyerGlobalUserId) });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof BadRequestException || error instanceof FoodOptionValidationError
        || error instanceof Error && Object.getPrototypeOf(error) === Error.prototype && knownCommercialErrors.has(error.message)) {
        return declined("commercial_benefit_review_required");
      }
      // Database/transport/unknown-commit errors propagate, with no retry.
      throw error;
    }
  }
}
