import { Prisma } from "@prisma/client";
import { z } from "zod";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import type { Cart } from "@zyon/shared-types";
import type { StorefrontCart } from "../../../modules/storefront/domain/ports/storefront-cart.port.js";
import { crossSellStorefrontCartBasisSchema } from "../../../modules/cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { storefrontLocalCartCommercialOutcomeV1Schema } from "../../../modules/storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { readStorefrontCartCommercial, resolveStorefrontCartCatalogItem } from "../../../modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.dependencies.js";
import { lockCrossSellSelectedAuthority } from "../../../modules/storefront/infrastructure/repositories/storefront-cross-sell-authority-fence.js";
import { assertLocalCartAdmission } from "../../../modules/storefront/infrastructure/repositories/local-cart-admission.js";
import { toCouponEntity } from "../../../modules/coupons/infrastructure/repositories/prisma-coupon.converters.js";
import { validateCoupon } from "../../../modules/coupons/domain/policies/coupon-validity.policy.js";
import { calculateCouponDiscount } from "../../../modules/coupons/domain/policies/coupon-discount-calculator.js";
import { commercialNotice } from "../../../modules/storefront/domain/services/commercial-notice.js";

const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const scopeSchema = z.strictObject({ merchantId: ref, cartId: ref });
const clockSchema = z.array(z.strictObject({ now: z.date(), isolation: z.literal("read committed") })).length(1);
export function combinedCouponReviewRequired(): never { throw new Error("storefront_combined_coupon_review_required"); }
function checked<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  try { const result = schema.safeParse(raw); if (result.success) return result.data; } catch { /* fixed boundary */ }
  return combinedCouponReviewRequired();
}
function wholeCents(raw: unknown): number { return moneyCents(raw) ?? combinedCouponReviewRequired(); }

/** Caller owns merchant/rules/settings BEFORE cart, then coupon. A reconstructed
 * zero-D/no-coupon snapshot is permitted ONLY after the caller has proved either
 * actual absence of benefits or the exact current reservation, source and D.
 * This helper never changes storage, reserves quota or grants buyer authority. */
export async function readCombinedCouponMerchandise(tx: Prisma.TransactionClient,
  rawScope: { merchantId: string; cartId: string }, calculationBasis: StorefrontCart) {
  const scope = checked(scopeSchema, rawScope), cart = structuredClone(calculationBasis);
  if (cart.merchantId !== scope.merchantId || cart.sessionId !== scope.cartId || cart.couponCode !== null
    || cart.discount !== 0 || cart.freeShipping !== false) return combinedCouponReviewRequired();
  const basis = checked(crossSellStorefrontCartBasisSchema, { items: cart.items, total: cart.total, discount: 0, couponCode: null, freeShipping: false });
  const selected = basis.items.find(item => item.crossSellIntent !== undefined);
  if (!selected?.crossSellIntent) return combinedCouponReviewRequired();
  await lockCrossSellSelectedAuthority(tx, scope.merchantId, basis, selected.variantId, selected.crossSellIntent.promotionId);
  const settings = await tx.checkoutSetting.findUnique({ where: { merchantId: scope.merchantId }, select: { merchantId: true, advancedRules: true } });
  if (settings) {
    const parsed = checked(z.object({ merchantId: ref, advancedRules: z.array(z.object({ enabled: z.boolean(),
      conditions: z.array(z.object({ field: z.string() })) })).max(200) }), settings);
    if (parsed.merchantId !== scope.merchantId || parsed.advancedRules.some(rule => rule.enabled
      && rule.conditions.some(condition => condition.field === "coupon_applied"))) return combinedCouponReviewRequired();
  }
  const quantities = new Map<string, number>();
  for (const line of cart.items) quantities.set(line.variantId, (quantities.get(line.variantId) ?? 0) + line.quantity);
  for (const line of cart.items) {
    const canonical = await resolveStorefrontCartCatalogItem(tx, scope.merchantId, line.variantId, line.selectedOptions?.map(option => option.itemId));
    if (canonical.sku !== line.sku || canonical.productId !== line.productId || canonical.unitPriceCents !== line.unitPriceCents) return combinedCouponReviewRequired();
    await assertLocalCartAdmission(tx, scope.merchantId, line.variantId, quantities.get(line.variantId)!, line.selectedOptions);
  }
  const clock = checked(clockSchema, await tx.$queryRaw`SELECT clock_timestamp() AS now,
    current_setting('transaction_isolation') AS isolation`)[0]!;
  const expiresAt: unknown = Reflect.get(cart, "expiresAt");
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= clock.now.getTime()) return combinedCouponReviewRequired();
  const { outcome } = await readStorefrontCartCommercial(tx, scope, cart, clock.now, false);
  // No silent replacement of an automatic cart-level contribution. That source
  // requires its own durable allocation; line product/cross-sell savings stay.
  if (outcome.discountCents !== 0 || outcome.freeShipping !== false) return combinedCouponReviewRequired();
  const policy = await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId } });
  if (!policy || policy.merchantId !== scope.merchantId) return combinedCouponReviewRequired();
  const rules = { maxDiscountPercent: policy.maxDiscountPercent.toNumber() };
  // Financial DTO projection deliberately excludes cost/margin regardless of
  // their value. Catalog/rule readers are the source, never JSON from the buyer.
  const engineCart: Cart = { currency: "BRL", total: outcome.quote.subtotalCents / 100, currentDiscount: 0,
    discountBudget: { version: 1, originalSubtotalCents: outcome.quote.originalSubtotalCents, promotionDiscountCents: outcome.quote.promotionDiscountCents },
    items: outcome.quote.items.map((line, index) => ({ sku: cart.items[index]!.sku, variantId: line.variantId, product_id: line.productId,
      name: cart.items[index]!.name, quantity: line.quantity, price: line.unitPriceCents / 100, originalPrice: line.baseUnitPriceCents / 100,
      variant: JSON.stringify([line.variantId, [...(line.selectedOptionItemIds ?? [])].sort()]) })) };
  return { now: clock.now, cart: engineCart, quote: outcome.quote, rules };
}

/** Dedicated opt-in writer authority. The default generic writer still refuses
 * coupon+cross-sell. Scope/row/reservation/quota and D are read before any
 * coupon-free merchandise reconstruction, in the exact same transaction. */
export async function readCombinedStorefrontCouponCommercial(tx: Prisma.TransactionClient,
  rawScope: { merchantId: string; cartId: string }, rawCart: StorefrontCart, trustedBuyerGlobalUserId?: string) {
  const scope = checked(scopeSchema, rawScope), cart = structuredClone(rawCart);
  if (cart.merchantId !== scope.merchantId || cart.sessionId !== scope.cartId || !Number.isSafeInteger(cart.discount)
    || cart.discount <= 0 || cart.discount > 2_147_483_647 || cart.freeShipping !== false) return combinedCouponReviewRequired();
  const code = checked(ref, cart.couponCode);
  const locked = checked(z.array(z.strictObject({ id: ref })).length(1),
    await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id=${scope.merchantId} AND code=${code} FOR UPDATE`);
  const row = await tx.coupon.findFirst({ where: { id: locked[0]!.id, merchantId: scope.merchantId, code } });
  if (!row || row.id !== locked[0]!.id || row.merchantId !== scope.merchantId || row.code !== code) return combinedCouponReviewRequired();
  const coupon = toCouponEntity(row).snapshot();
  if (coupon.strategy_incentive_execution_id || !["fixed", "percent"].includes(coupon.discount_type)
    || coupon.allowed_regions.length || coupon.blocked_regions.length) return combinedCouponReviewRequired();
  const reservations = await tx.couponRedemption.findMany({ where: { merchantId: scope.merchantId, sessionId: scope.cartId,
    status: { not: "cancelled" } }, take: 2 });
  if (reservations.length !== 1) return combinedCouponReviewRequired();
  const reservation = reservations[0]!;
  const reserved = Prisma.Decimal.isDecimal(reservation.discountApplied) ? reservation.discountApplied.times(100) : null;
  if (!reserved || !reserved.isInteger() || !reserved.eq(cart.discount) || reservation.merchantId !== scope.merchantId
    || reservation.sessionId !== scope.cartId || reservation.couponId !== coupon.id || reservation.status !== "applied" || reservation.orderId !== null
    || reservation.buyerGlobalUserId !== null && reservation.buyerGlobalUserId !== trustedBuyerGlobalUserId
    || coupon.max_per_buyer !== null && !reservation.buyerGlobalUserId) return combinedCouponReviewRequired();
  if (coupon.max_usages !== null && await tx.couponRedemption.count({ where: { merchantId: scope.merchantId, couponId: coupon.id,
    status: { not: "cancelled" } } }) > coupon.max_usages) return combinedCouponReviewRequired();
  if (coupon.max_per_buyer !== null && await tx.couponRedemption.count({ where: { merchantId: scope.merchantId, couponId: coupon.id,
    buyerGlobalUserId: reservation.buyerGlobalUserId, status: { not: "cancelled" } } }) > coupon.max_per_buyer) return combinedCouponReviewRequired();
  // Proof above precedes reconstruction. Original persisted lines/prices and
  // accepted intent are preserved; neither reserve nor stored cart is modified.
  const authority = await readCombinedCouponMerchandise(tx, scope, { ...cart, couponCode: null, discount: 0 });
  const projected: Cart = { ...authority.cart, currentDiscount: cart.discount / 100 };
  if (!validateCoupon(coupon, projected, undefined, authority.now).valid
    || wholeCents(calculateCouponDiscount(coupon, projected.total)) < cart.discount) return combinedCouponReviewRequired();
  const decision = evaluateCombinedDiscount(projected, authority.rules, cart.discount);
  if (decision.kind !== "authorized" || decision.cartDiscountCents !== cart.discount) return combinedCouponReviewRequired();
  const notices = decision.remainingDiscountCents === 0 && decision.totalDiscountCents > 0
    ? [commercialNotice("discount_limit_reached")] : authority.quote.commercialNotices;
  return checked(storefrontLocalCartCommercialOutcomeV1Schema, { version: 1, discountCents: cart.discount, freeShipping: false,
    quote: { ...authority.quote, merchandiseTotalCents: authority.quote.subtotalCents - cart.discount,
      ...(notices ? { commercialNotices: notices } : {}) } });
}
