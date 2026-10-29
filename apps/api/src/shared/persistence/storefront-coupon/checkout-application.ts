import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { z } from "zod";
import type { CouponSnapshot } from "../../../modules/coupons/domain/entities/coupon.entity.js";
import { toCouponEntity } from "../../../modules/coupons/infrastructure/repositories/prisma-coupon.converters.js";
import { checkoutWithCoupon } from "../../../modules/coupons/application/services/checkout-coupon.js";
import { toCheckoutSession } from "../../../modules/checkout/infrastructure/prisma/checkout-session.mapper.js";
import { toMerchantRules } from "../../../modules/checkout/infrastructure/prisma/merchant-rules.mapper.js";
import { readStoredCheckoutCouponBinding } from "../../../modules/checkout/domain/services/checkout-coupon-storage.js";
import { lockStorefrontCart } from "../storefront-cart-lock.js";
import { storefrontCartHasCheckoutBinding } from "./cart-owner-fence.js";
import { validateReleasedCheckoutCouponGeneration } from "./generation-release.js";
import { assertStorefrontCouponSourceProjection } from "./source-projection-basis.js";
import { readStorefrontCouponForCheckout } from "./admission.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../modules/storefront/domain/food-options.js";
import { foodSelectionLimits, validateFoodMetadata } from "../../../modules/catalog/domain/services/food-options-validation.js";
import type { NormalCheckoutCouponReader } from "../../../modules/coupons/domain/ports/normal-checkout-coupon-reader.port.js";
import { paymentCartFingerprint } from "../../../modules/checkout/domain/services/payment-cart-fingerprint.js";

const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const cents = z.number().int().min(0).max(2_147_483_647);
const inputSchema = z.strictObject({ merchantId: ref, checkoutSessionId: ref, code: ref, expectedVersion: z.number().int().nonnegative() });
const linesSchema = z.array(z.object({ variantId: ref, productId: ref, sku: ref, unitPriceCents: cents,
  quantity: z.number().int().min(1).max(99),
  selectedOptions: z.array(z.object({ itemId: ref }).passthrough()).max(100).optional(),
  selectedServiceSlot: z.object({ slotId: ref }).passthrough().optional() })).min(1).max(100);
type Applied = { redemption_id: string; discount_applied: number; shipping_discount_applied: number; coupon: CouponSnapshot;commercial_notices?:Cart["commercialNotices"] };
export type StorefrontCheckoutCouponFinancialInput = { merchant_id: string; session_id: string; code: string; cart: Cart;
  merchantRules: MerchantRules; buyer_global_user_id: string; buyer_region?: string; has_existing_commercial_benefit: boolean; source: "manual" };
const review = (): never => { throw new ConflictException({ code: "checkout_review_required",
  message: "As condições do cupom mudaram. Revise o pedido antes de pagar." }); };
function jsonCart(cart: Cart): Prisma.InputJsonObject {
  // Persisted JSON and validated monetary results only. Refuse lossy numbers;
  // dropping absent optional metadata is not permission to coerce money.
  const serialized = JSON.stringify(cart, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) return review(); return value;
  });
  return z.record(z.string(), z.json()).parse(JSON.parse(serialized));
}

/** Cross-aggregate SQL coordinator, not a coupon/price/identity issuer. Caller
 * owns merchant/rules/settings -> checkout anchor/row in THIS transaction.
 * Financial callback MUST be the existing command bound to this SAME tx.
 * No nested transaction, client cart input, fake session alias or retry. */
export async function applyStorefrontCheckoutCouponInTransaction(tx: Prisma.TransactionClient,
  raw: z.input<typeof inputSchema>, apply: (input: StorefrontCheckoutCouponFinancialInput) => Promise<Applied>,
  readNormal?:NormalCheckoutCouponReader<Prisma.TransactionClient>) {
  const input = inputSchema.parse(raw), scope = { merchantId: input.merchantId, sessionId: input.checkoutSessionId };
  const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId || stored.version !== input.expectedVersion) return review();
  let session = toCheckoutSession(stored);const cartId = ref.parse(session.cart.cart_ref);
  if (session.cart.source !== "storefront" || session.cart.currency !== "BRL" || !session.globalUserId?.trim()
    ) return review();
  const normal=session.cart.items.some(item=>item.crossSellIntent!==undefined);
  if(normal){
    if(!readNormal)return review();
    const canonical=await readNormal(tx,scope);
    if(canonical.merchantId!==session.merchantId||canonical.sessionId!==session.sessionId||canonical.globalUserId!==session.globalUserId
      ||canonical.persistenceVersion!==stored.version||paymentCartFingerprint(canonical)!==paymentCartFingerprint(session)
      ||!isDeepStrictEqual(canonical.cart.discountBudget,session.cart.discountBudget))return review();
    session=canonical;
  }
  const verified = session.customer?.email_verified === true && Boolean(session.customer.email?.trim())
    || session.customer?.phone_verified === true && Boolean(session.customer.phone?.replace(/\D/g, ""));
  if (!verified) throw new BadRequestException("COUPON_BUYER_IDENTITY_REQUIRED");
  await lockStorefrontCart(tx, scope.merchantId, cartId);
  if (await storefrontCartHasCheckoutBinding(tx, scope.merchantId, cartId)) throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
  const binding = readStoredCheckoutCouponBinding(stored.cart);
  if (binding) {
    if (binding.state !== "released") throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
    await validateReleasedCheckoutCouponGeneration(tx, stored);
  }
  // Legacy financial rows without binding proof cannot be treated as resolved.
  // Released bound generations were independently validated by the owner fence.
  const unresolved = await tx.$queryRaw<Array<{ id: string }>>`SELECT c.id FROM checkout_sessions c
    WHERE c.merchant_id=${scope.merchantId} AND c.cart->>'cart_ref'=${cartId}
      AND NOT (c.cart ? '_storefrontCouponBinding') AND (
        EXISTS (SELECT 1 FROM payment_intents p WHERE p.merchant_id=c.merchant_id AND p.session_id=c.session_id)
        OR EXISTS (SELECT 1 FROM completed_orders o WHERE o.merchant_id=c.merchant_id AND o.session_id=c.session_id)) LIMIT 1`;
  if (unresolved.length) throw new ConflictException("CHECKOUT_PAYMENT_REQUIRES_REOPEN");
  const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: cartId } } });
  const [{ now }] = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
  if (!source || source.merchantId !== scope.merchantId || source.sessionId !== cartId || source.expiresAt <= now
    || source.couponCode !== null || source.discount !== 0 || source.freeShipping !== false
    || (session.cart.currentDiscount ?? 0) !== 0 || session.cart.commercialNudge || session.cart.appliedBenefits?.some(value => value.amount > 0)) return review();
  const lines = linesSchema.parse(source.items), sourceItems = z.array(z.json()).parse(source.items);
  // Same deterministic row order as other catalog admission readers. Merchant
  // fence precedes the cart; these exact rows also fence direct stock/price SQL
  // writers. Re-read only AFTER waiting. This is not a stock reservation.
  const ids = [...new Set(lines.map(line => line.variantId))].sort();
  await tx.$queryRaw`SELECT p.id FROM products p WHERE p.merchant_id=${scope.merchantId}
    AND p.id IN (SELECT v.product_id FROM product_variants v WHERE v.id=ANY(${ids}::text[])) ORDER BY p.id FOR SHARE OF p`;
  await tx.$queryRaw`SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id
    WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY v.id FOR SHARE OF v`;
  await tx.$queryRaw`SELECT price.id FROM product_prices price JOIN product_variants v ON v.id=price.variant_id
    JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${scope.merchantId}
    AND v.id=ANY(${ids}::text[]) ORDER BY price.id FOR SHARE OF price`;
  await tx.$queryRaw`SELECT stock.id FROM product_stock stock JOIN product_variants v ON v.id=stock.variant_id
    JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${scope.merchantId}
    AND v.id=ANY(${ids}::text[]) ORDER BY stock.id FOR SHARE OF stock`;
  try { await assertStorefrontCouponSourceProjection(tx, { merchantId: scope.merchantId, cartId }, source, session.cart); }
  catch (error) {
    // The shared projection validator uses this fixed integrity sentinel. New
    // application maps ONLY that known mismatch to the existing review UX;
    // storage failures/unknown errors propagate unchanged and roll back.
    if (error instanceof Error && error.message === "checkout_coupon_binding_conflict") return review();
    throw error;
  }
  const variants = await tx.productVariant.findMany({ where: { id: { in: [...new Set(lines.map(line => line.variantId))] }, isActive: true,
    product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } },
    select: { id: true, productId: true, sku: true, isActive: true,
      product: { select: { id: true, merchantId: true, isActive: true, deletedAt: true, type: true, metadata: true } },
      price: { select: { variantId: true, basePriceInCents: true, currency: true } },
      stock: { select: { quantity: true, reserved: true } } } });
  const itemKey = (variantId: string, productId: string, sku: string, quantity: number, options: string[], slot?: string) =>
    JSON.stringify([variantId, productId, sku, quantity, [...options].sort(), slot ?? null]);
  const projected = new Map(session.cart.items.map(item => [itemKey(item.variantId!, item.product_id!, item.sku, item.quantity,
    item.variant === undefined ? [] : z.tuple([ref, z.array(ref)]).parse(JSON.parse(item.variant))[1], item.fulfillmentSchedule?.slotId), item]));
  for (const line of lines) {
    const variant = variants.find(value => value.id === line.variantId && value.productId === line.productId && value.sku === line.sku
      && value.isActive && value.product.merchantId === scope.merchantId && value.product.isActive && value.product.deletedAt === null);
    if (!variant?.price || variant.price.currency !== "BRL" || variant.price.variantId !== variant.id
      || !cents.safeParse(variant.price.basePriceInCents).success || validateFoodMetadata(variant.product.metadata)) return review();
    // NEW grant: independently prove current B, including canonical paid options.
    // The source projection checker preserves nominal legacy read semantics;
    // matching two stale saved hints must not authorize another discount.
    const groups = extractOptionGroups(variant.product.metadata);
    let options;
    try { options = resolveSelectedOptions(groups, (line.selectedOptions ?? []).map(value => value.itemId)); }
    catch { return review(); }
    if (new Set((line.selectedOptions ?? []).map(value => value.itemId)).size !== (line.selectedOptions ?? []).length) return review();
    for (const group of groups) {
      const count = options.selected.filter(value => value.groupId === group.id).length, limits = foodSelectionLimits(group);
      if (count < limits.min || count > limits.max) return review();
    }
    const sorted = (value: Array<{ itemId: string }>) => [...value].sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
    const item = projected.get(itemKey(line.variantId, line.productId, line.sku, line.quantity,
      (line.selectedOptions ?? []).map(value => value.itemId), line.selectedServiceSlot?.slotId));
    if (!item || !isDeepStrictEqual(sorted(options.selected), sorted(line.selectedOptions ?? []))
      || variant.price.basePriceInCents + options.priceModifierInCents !== moneyCents(item.originalPrice ?? item.price)) return review();
    const quantity = lines.filter(value => value.variantId === line.variantId).reduce((sum, value) => sum + value.quantity, 0);
    if (variant.stock.some(value => !cents.safeParse(value.quantity).success || !cents.safeParse(value.reserved).success)) return review();
    if (variant.product.type === "physical" && variant.stock.reduce((sum, value) => sum + Math.max(0, value.quantity - value.reserved), 0) < quantity)
      throw new BadRequestException("checkout_insufficient_stock");
  }
  await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id=${scope.merchantId} AND code=${input.code} FOR UPDATE`;
  const row = await tx.coupon.findUnique({ where: { merchantId_code: { merchantId: scope.merchantId, code: input.code } } });
  if (!row) throw new BadRequestException("COUPON_NOT_FOUND");
  const coupon = toCouponEntity(row).snapshot();
  if (coupon.merchant_id !== scope.merchantId || coupon.code !== input.code || coupon.strategy_incentive_execution_id
    || !["fixed", "percent"].includes(coupon.discount_type)) return review();
  if ((await tx.couponRedemption.findMany({ where: { merchantId: scope.merchantId, sessionId: cartId, status: { not: "cancelled" } }, take: 2 })).length) return review();
  const policy = await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId } });
  if (!policy) return review(); const rules = toMerchantRules(policy);
  const basis = evaluateCombinedDiscount(session.cart, rules, 0);
  if (basis.kind !== "authorized") return review();
  const result = await apply({ merchant_id: scope.merchantId, session_id: cartId, code: input.code, cart: session.cart,
    merchantRules: rules, buyer_global_user_id: session.globalUserId, buyer_region: session.customer?.address?.state?.trim().toUpperCase(),
    has_existing_commercial_benefit: false, source: "manual" });
  const discount = moneyCents(result.discount_applied);
  if (discount === null || discount <= 0 || result.shipping_discount_applied !== 0 || result.coupon.id !== coupon.id
    || result.coupon.merchant_id !== scope.merchantId || result.coupon.code !== input.code) return review();
  const decision = evaluateCombinedDiscount(session.cart, rules, discount);
  if (decision.kind !== "authorized" || decision.cartDiscountCents !== discount) return review();
  const next = checkoutWithCoupon(session, result);
  const changed = await tx.storefrontCart.updateMany({ where: { id: source.id, merchantId: scope.merchantId, sessionId: cartId,
    items: { equals: sourceItems }, total: source.total, discount: source.discount, couponCode: source.couponCode,
    freeShipping: source.freeShipping, updatedAt: source.updatedAt }, data: { couponCode: input.code, discount, updatedAt: now } });
  if (changed.count !== 1) return review();
  const candidate = await readStorefrontCouponForCheckout(tx, next, { requireVerifiedBuyer: true, requireRegion: true });
  if (!candidate || candidate.cartId !== cartId || candidate.checkoutSessionId !== scope.sessionId || candidate.redemptionId !== result.redemption_id) return review();
  const cart:Prisma.InputJsonObject = {...jsonCart(next.cart),
    ...(binding?{_storefrontCouponBinding:z.record(z.string(),z.json()).parse(binding)}:{})};
  const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version },
    data: { cart, updatedAt: now } });
  if (saved.count !== 1) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
  await tx.checkoutEvent.create({ data: { ...scope, eventName: "coupon_applied", occurredAt: now } });
  const committed = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!committed || committed.version !== stored.version + 1) return review();
  if(normal){const canonical=await readNormal!(tx,scope);
    if(canonical.persistenceVersion!==committed.version||paymentCartFingerprint(canonical)!==paymentCartFingerprint(toCheckoutSession(committed)))return review();}
  return { result, session: toCheckoutSession(committed), rules };
}
