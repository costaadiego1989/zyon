import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { MerchantRules } from "@zyon/shared-types";
import { z } from "zod";
import type { StorefrontCouponCartPort } from "../../domain/ports/storefront-coupon-cart.port.js";
import { storefrontCouponCartInputSchema, storefrontCouponCartScopeSchema, storefrontCouponCartResultSchema,
  type StorefrontCouponCartResult } from "../../domain/contracts/storefront-coupon-cart.schemas.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import type { DiscountRulesEnginePort } from "../../../coupons/domain/ports/discount-rules-engine.port.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import type { CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import type { CouponTransactionRepository } from "../../../coupons/domain/ports/coupon-transaction-repository.port.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import { loadCartCosts } from "../../application/services/reevaluate-cart-rules.js";
import { applyProductPromoPricing, getProductPromoBadge } from "../../application/services/storefront-cart-promo.pricing.js";
import { toEngineCart } from "../../domain/services/cart-rules-engine.service.js";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import { commercialNotice } from "../../domain/services/commercial-notice.js";
import { PrismaStorefrontCartUnitOfWork } from "./prisma-storefront-cart-unit-of-work.js";

/** Composition supplies context-owned adapters bound to this exact transaction.
 * No ambient client, nested transaction or policy provisioning fallback. */
export interface StorefrontCouponCartDependencies {
  couponsFor(tx: Prisma.TransactionClient): CouponRepository;
  transactionsFor(tx: Prisma.TransactionClient): CouponTransactionRepository;
  promotionsFor(tx: Prisma.TransactionClient): ProductPromotionRepositoryPort;
  readExistingRules(tx: Prisma.TransactionClient, merchantId: string): Promise<MerchantRules | undefined>;
}

const identifier = storefrontCouponCartScopeSchema.shape.cartId;
const snapshotSchema = z.object({ id: identifier, merchant_id: identifier, code: z.string().min(1).max(191),
  strategy_incentive_execution_id: identifier.nullable().optional(),
  discount_type: z.enum(["percent", "fixed", "shipping_free", "shipping_percent", "shipping_fixed"]),
  discount_value: z.number().finite().nonnegative(), min_cart_total: z.number().finite().nonnegative().nullable(),
  max_usages: z.number().int().nonnegative().nullable(), max_per_buyer: z.number().int().nonnegative().nullable(),
  allowed_skus: z.array(z.string()), blocked_skus: z.array(z.string()), allowed_regions: z.array(z.string()), blocked_regions: z.array(z.string()),
  status: z.enum(["active", "paused", "expired", "archived"]), starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }).nullable(),
}).refine(value => (value.discount_type !== "percent" && value.discount_type !== "shipping_percent") || value.discount_value <= 100);
const knownRejections = new Set(["COUPON_NOT_FOUND", "COUPON_STRATEGY_CHECKOUT_REQUIRED", "COUPON_INVALID", "COUPON_NOT_YET_ACTIVE", "COUPON_EXPIRED",
  "COUPON_MIN_CART_NOT_MET", "COUPON_SKU_NOT_ALLOWED", "COUPON_SKU_BLOCKED", "COUPON_REGION_NOT_ALLOWED", "COUPON_REGION_BLOCKED",
  "CHECKOUT_COMMERCIAL_BENEFIT_ALREADY_APPLIED", "COUPON_SHIPPING_NOT_CALCULATED", "COUPON_FREE_SHIPPING_NOT_ALLOWED", "COUPON_SHIPPING_DISCOUNT_NOT_ALLOWED",
  "COUPON_ALREADY_APPLIED", "COUPON_EXHAUSTED", "COUPON_PER_BUYER_LIMIT_REACHED",
  ...["product_cost_missing", "product_option_cost_missing", "minimum_margin_violation", "discount_disabled_by_merchant", "capped_by_combined_discount_limit",
    "discount_limit_reached", "existing_discount_above_limit", "economic_input_invalid", "cart_total_mismatch", "incentive_currency_unsupported",
    "discount_not_requested", "discount_budget_invalid"].map(code => `COUPON_DISCOUNT_REJECTED:${code}`),
]);
class CouponRejection extends Error {
  constructor(readonly reason: string, readonly notice: "benefit_not_combinable" | "benefit_conditions_not_met" | "discount_limit_reached" | "discount_unavailable" = "benefit_conditions_not_met") { super(reason); }
}
function reject(reason: string, notice?: CouponRejection["notice"]): never { throw new CouponRejection(reason, notice); }
const commercialCodes = new Set(["discount_price_review_required", "product_promotion_window_invalid", "product_promotion_descriptor_ambiguous",
  "product_promotion_descriptor_invalid", "product_promotion_allocation_overflow"]);
function classify(error: unknown): never {
  if (error instanceof CouponRejection) throw error;
  if ((error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException)
    && knownRejections.has(error.message)) reject(error.message, error.message === "CHECKOUT_COMMERCIAL_BENEFIT_ALREADY_APPLIED" ? "benefit_not_combinable" : undefined);
  if (error instanceof z.ZodError || (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype && commercialCodes.has(error.message))) reject("commercial_benefit_review_required");
  throw error;
}

/** Existing storefront coupon flow, one transaction/lock/commit. No provider,
 * default policy, ambient client, cancellation, automatic retry or new endpoint. */
export class PrismaStorefrontCouponCartAdapter implements StorefrontCouponCartPort {
  constructor(private readonly prisma: PrismaClient, private readonly discountEngine: DiscountRulesEnginePort,
    private readonly dependencies: StorefrontCouponCartDependencies) {}

  async apply(rawScope: Parameters<StorefrontCouponCartPort["apply"]>[0], rawInput: Parameters<StorefrontCouponCartPort["apply"]>[1]): Promise<StorefrontCouponCartResult> {
    const scope = storefrontCouponCartScopeSchema.parse(rawScope), input = storefrontCouponCartInputSchema.parse(rawInput);
    try {
      return await new PrismaStorefrontCartUnitOfWork(this.prisma).run(scope, async ({ tx, cart: bound }) => {
        try {
          const row = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
          if (!row) reject("cart_empty");
          const cart: StorefrontCart = { ...row, items: row.items as unknown as StorefrontCart["items"] };
          if (cart.merchantId !== scope.merchantId || cart.sessionId !== scope.cartId || !Array.isArray(cart.items)) reject("commercial_benefit_review_required");
          if (cart.items.length === 0) reject("cart_empty");
          if (cart.items.some(item => item.crossSellIntent !== undefined)) reject("commercial_benefit_review_required", "benefit_not_combinable");
          const expected = structuredClone(cart);
          const active = z.strictObject({ id: identifier }).nullable().parse(await tx.couponRedemption.findFirst({ where: { merchantId: scope.merchantId, sessionId: scope.cartId, status: { not: "cancelled" } }, select: { id: true } }));
          if (active) reject("CHECKOUT_COMMERCIAL_BENEFIT_ALREADY_APPLIED", "benefit_not_combinable");
          // Snapshot/validity MUST be read AFTER locking the actual scoped coupon.
          await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id = ${scope.merchantId} AND code = ${input.code} FOR UPDATE`;
          const coupons = this.dependencies.couponsFor(tx), coupon = await coupons.findByCode(scope.merchantId, input.code);
          if (!coupon) reject("COUPON_NOT_FOUND");
          const snapshot = snapshotSchema.parse(coupon.snapshot());
          if (snapshot.merchant_id !== scope.merchantId || snapshot.code !== input.code) reject("commercial_benefit_review_required");
          if (snapshot.strategy_incentive_execution_id) reject("COUPON_STRATEGY_CHECKOUT_REQUIRED");
          if (snapshot.allowed_regions.length || snapshot.blocked_regions.length) reject("COUPON_BUYER_REGION_REQUIRED");
          if (snapshot.max_per_buyer !== null && !input.trustedBuyerGlobalUserId) reject("COUPON_BUYER_IDENTITY_REQUIRED");
          const rules = await readExistingMerchantRules({ getExistingRules: merchantId => this.dependencies.readExistingRules(tx, merchantId),
            getRules: async () => { throw new Error("storefront_coupon_default_policy_forbidden"); } }, scope.merchantId);
          if (!rules) reject("merchant_rules_unavailable");
          const hadExistingBenefit = Boolean(cart.discount || cart.freeShipping || cart.couponCode);
          const costs = await loadCartCosts(tx, scope.merchantId, cart, true, true);
          if (!cart.couponCode) cart.discount = 0;
          const promoMeta = await applyProductPromoPricing(this.dependencies.promotionsFor(tx), scope.merchantId, cart, { rules, costsByVariant: costs });
          const engineCart = toEngineCart(cart, costs), current = evaluateCombinedDiscount(engineCart, rules, cart.discount);
          if (current.kind !== "authorized") reject("commercial_benefit_review_required");
          if (current.totalDiscountCents > 0 && current.remainingDiscountCents === 0) reject("discount_limit_reached", "discount_limit_reached");
          if (rules.maxDiscountPercent === 0) reject("discount_disabled_by_merchant", "discount_unavailable");
          const result = await new ApplyCouponUseCase(coupons, this.dependencies.transactionsFor(tx), this.discountEngine).execute({
            merchant_id: scope.merchantId, session_id: scope.cartId, code: input.code, cart: engineCart, merchantRules: rules,
            has_existing_commercial_benefit: hadExistingBenefit, buyer_global_user_id: input.trustedBuyerGlobalUserId, source: "manual",
          });
          const discountCents = z.number().int().min(0).max(2_147_483_647).parse(Math.round(result.discount_applied * 100));
          const confirmed = evaluateCombinedDiscount(engineCart, rules, discountCents);
          if (confirmed.kind !== "authorized" || confirmed.cartDiscountCents !== discountCents) reject("commercial_benefit_review_required");
          const updated = await bound.applyCoupon(scope.merchantId, scope.cartId, input.code, discountCents, expected);
          return storefrontCouponCartResultSchema.parse({ applied: true, reason: "success", couponCode: input.code, discountCents, discount: discountCents / 100,
            cartId: updated.sessionId, total: cart.total / 100, newTotal: (cart.total - discountCents) / 100,
            itemCount: updated.items.reduce((sum, item) => sum + item.quantity, 0), items: cart.items.map(item => {
              const badge = getProductPromoBadge(promoMeta, item);
              return { variantId: item.variantId, name: item.name, quantity: item.quantity, unitPrice: item.unitPriceCents / 100, lineTotal: item.unitPriceCents * item.quantity / 100,
                optionItemIds: (item.selectedOptions ?? []).map(option => option.itemId), serviceSlotId: item.selectedServiceSlot?.slotId ?? null,
                selectionLabel: item.selectedOptions?.map(option => `${option.groupName}: ${option.itemName}`).join(" · ") || undefined,
                ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}), ...(item.selectedServiceSlot ? { selectedServiceSlot: item.selectedServiceSlot } : {}),
                ...(item.selectedOptions ? { selectedOptions: item.selectedOptions.map(option => ({ itemId: option.itemId, groupName: option.groupName, itemName: option.itemName, priceModifier: option.priceModifierInCents / 100 })) } : {}),
                ...(badge ? { originalPrice: badge.originalPriceCents / 100, ...(badge.discountPercent === undefined ? {} : { discountPercent: badge.discountPercent }), ...(badge.coupon === undefined ? {} : { coupon: badge.coupon }) } : {}) };
            }), commercialNotices: confirmed.totalDiscountCents > 0 && confirmed.remainingDiscountCents === 0 ? [commercialNotice("discount_limit_reached")] : cart.commercialNotices,
          });
        } catch (error) { classify(error); }
      });
    } catch (error) {
      if (error instanceof CouponRejection) return storefrontCouponCartResultSchema.parse({ applied: false, reason: error.reason,
        ...(error.reason === "cart_empty" || error.reason === "merchant_rules_unavailable" ? {} : { commercialNotices: [commercialNotice(error.notice)] }) });
      throw error;
    }
  }
}

