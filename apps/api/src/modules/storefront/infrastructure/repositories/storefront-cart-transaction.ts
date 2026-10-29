import { BadRequestException, ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { crossSellAcceptedLineIntentSchema } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { evaluateStorefrontCartCommercial } from "./prisma-storefront-local-cart-effect.dependencies.js";
import type { StorefrontLocalCartCommercialOutcomeV1 } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { storefrontLocalCartCommercialOutcomeV1Schema } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { z } from "zod";
import { storefrontCartHasCheckoutBinding, assertStorefrontCartUnbound, storefrontCartBindingConflict } from "./storefront-checkout-binding-fence.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { releaseLegacyStorefrontCouponSource, legacyStorefrontCouponReleaseReview } from "../../../../shared/persistence/storefront-coupon/legacy-source-release.js";
import { readNormalCheckoutSourceProjection } from "../../../../shared/persistence/storefront-normal-checkout-read.js";
export { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";

export function crossSellQuoteReviewRequired(): UnprocessableEntityException {
  return new UnprocessableEntityException({ statusCode: 422, code: "cross_sell_quote_review_required",
    message: "Este benefício precisa de uma nova cotação antes de adicionar o item." });
}
export function cartHasCrossSellIntent(cart: Pick<StorefrontCart, "items">): boolean {
  return cart.items.some(item => item.crossSellIntent !== undefined);
}
// Exact internal machine codes only, not prose/LLM/provider-message parsing.
const commercialRefusalCodes = new Set([
  "cross_sell_quote_review_required", "storefront_effect_catalog_authority_invalid", "storefront_effect_cart_scope_invalid",
  "storefront_effect_cart_authority_invalid", "storefront_effect_existing_price_or_product_changed", "storefront_effect_merchant_authority_invalid",
  "storefront_effect_rules_unsupported", "storefront_effect_commercial_authority_invalid", "product_promotion_window_invalid",
  "product_promotion_descriptor_ambiguous", "product_promotion_descriptor_invalid", "product_promotion_allocation_overflow",
]);
/** Only known validation/commercial failures are definitive review refusals.
 * Unknown DB/transport/commit/falsy errors retain their identity: never retry or
 * claim a known non-execution merely because an acknowledgement was lost. */
export function rethrowStorefrontCommercialFailure(error: unknown): never {
  if (error instanceof z.ZodError || error instanceof BadRequestException
    || (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype && commercialRefusalCodes.has(error.message))) {
    throw crossSellQuoteReviewRequired();
  }
  throw error;
}

export function cartTotal(cart: StorefrontCart): number {
  const total = cart.items.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 ||
        !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) throw new BadRequestException("cart_line_invalid");
    return sum + line.unitPriceCents * line.quantity;
  }, 0);
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new BadRequestException("cart_total_invalid");
  return total;
}

export function assertMarketplaceDiscount(cart: StorefrontCart, discount: number, freeShipping = false): void {
  if (cart.items.some(line => line.marketplace) && (discount !== 0 || freeShipping)) {
    throw new ConflictException("marketplace_discount_allocation_required");
  }
}

export type StorefrontCartTransactionWork<T> = (tx: Prisma.TransactionClient, cart: StorefrontCart) => Promise<T>;
/** Internal composition only, never a body/LLM-supplied bypass. The canonical
 * implementation must reread actual coupon/reservation and catalog in this tx. */
export type StorefrontCombinedCouponRevalidator = (tx: Prisma.TransactionClient,
  scope: { merchantId: string; cartId: string }, cart: StorefrontCart) => Promise<StorefrontLocalCartCommercialOutcomeV1>;
/** Dedicated infrastructure lifecycle only. Must prove the BEFORE source and
 * exact live reservation, then cancel it in this tx before allowing benefit loss.
 * Default writers never get this callback; matching JSON is not authority. */
export type StorefrontCombinedCouponLifecycle = (tx: Prisma.TransactionClient,
  scope: { merchantId: string; cartId: string }, before: StorefrontCart, after: StorefrontCart) => Promise<void>;
export type StorefrontCartTransactionResult<T> = { result: T; cart: StorefrontCart; commercial?: StorefrontLocalCartCommercialOutcomeV1 };
export type StorefrontCartAccess = "mutate" | "read";

/** Enlists in the supplied transaction; never starts or commits another one. */
export function withStorefrontCartInTransaction<T>(tx: Prisma.TransactionClient, merchantId: string, sessionId: string,
  work: StorefrontCartTransactionWork<T>, access?: "mutate", revalidateCoupon?: StorefrontCombinedCouponRevalidator,
  couponLifecycle?: StorefrontCombinedCouponLifecycle): Promise<StorefrontCartTransactionResult<T>>;
export function withStorefrontCartInTransaction<T>(tx: Prisma.TransactionClient, merchantId: string, sessionId: string,
  work: StorefrontCartTransactionWork<T>, access: StorefrontCartAccess | undefined, revalidateCoupon?: StorefrontCombinedCouponRevalidator,
  couponLifecycle?: StorefrontCombinedCouponLifecycle): Promise<StorefrontCartTransactionResult<T | void>>;
export async function withStorefrontCartInTransaction<T>(tx: Prisma.TransactionClient, merchantId: string, sessionId: string,
  work: StorefrontCartTransactionWork<T>, access: StorefrontCartAccess = "mutate", revalidateCoupon?: StorefrontCombinedCouponRevalidator,
  couponLifecycle?: StorefrontCombinedCouponLifecycle): Promise<StorefrontCartTransactionResult<T | void>> {
  if(access==="read"){
    const normal=await readNormalCheckoutSourceProjection(tx,{merchantId,cartId:sessionId});
    if(normal)return {result:undefined,cart:normal.source};
  }
  await lockStorefrontCart(tx, merchantId, sessionId);
  const bound = await storefrontCartHasCheckoutBinding(tx, merchantId, sessionId);
  if (bound) {
    if (access !== "read") assertStorefrontCartUnbound(bound);
    const stored = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
    if (!stored || stored.merchantId !== merchantId || stored.sessionId !== sessionId || !Array.isArray(stored.items)) return storefrontCartBindingConflict();
    // getOrCreate is the only read caller. Do not invoke mutation callback, TTL,
    // upsert, rules or repricing against a checkout-owned commercial snapshot.
    return { result: undefined, cart: { ...stored, items: stored.items as unknown as StorefrontCart["items"] } };
  }
  const row = await tx.storefrontCart.upsert({ where: { merchantId_sessionId: { merchantId, sessionId } },
    create: { merchantId, sessionId, expiresAt: new Date(Date.now() + 72 * 3600_000) }, update: {} });
  const cart = { ...row, items: row.items as unknown as StorefrontCart["items"] };
  if (!Array.isArray(cart.items)) throw new ConflictException("cart_items_invalid");
  const hadIntent = cartHasCrossSellIntent(cart);
  if (hadIntent) {
    if (cart.merchantId !== merchantId || cart.sessionId !== sessionId) throw crossSellQuoteReviewRequired();
    for (const item of cart.items) if (item.crossSellIntent !== undefined && !crossSellAcceptedLineIntentSchema.safeParse(item.crossSellIntent).success) throw crossSellQuoteReviewRequired();
  }
  const existingCombinedCoupon = hadIntent ? cart.couponCode : null, existingCombinedDiscount = cart.discount;
  // Check BEFORE callbacks/empty-cart normalization: otherwise clear/removal of
  // the last line could erase D while leaving its real reservation alive.
  if (existingCombinedCoupon !== null && !revalidateCoupon && !couponLifecycle) throw crossSellQuoteReviewRequired();
  const lifecycleBefore = existingCombinedCoupon !== null && couponLifecycle ? structuredClone(cart) : undefined;
  const legacyCouponBefore = !hadIntent && cart.couponCode !== null && access !== "read" ? structuredClone(cart) : undefined;
  const result = await work(tx, cart);
  let releasedLegacyCoupon = false;
  if (legacyCouponBefore && (cart.items.length === 0 || cart.couponCode !== legacyCouponBefore.couponCode || cart.discount !== legacyCouponBefore.discount)) {
    await releaseLegacyStorefrontCouponSource(tx, { merchantId, cartId: sessionId }, legacyCouponBefore, cart);
    cart.couponCode = null; releasedLegacyCoupon = true;
  }
  if (existingCombinedCoupon !== null && (cart.items.length === 0 || cart.couponCode !== existingCombinedCoupon
    || cart.discount !== existingCombinedDiscount)) {
    if (!couponLifecycle || !lifecycleBefore || cart.couponCode !== null || cart.discount !== 0 || cart.freeShipping !== false) throw crossSellQuoteReviewRequired();
    await couponLifecycle(tx, { merchantId, cartId: sessionId }, lifecycleBefore, structuredClone(cart));
  }
  cart.total = cartTotal(cart);
  let commercial: StorefrontLocalCartCommercialOutcomeV1 | undefined;
  if (hadIntent || cartHasCrossSellIntent(cart)) {
    if (cart.items.length === 0) { cart.discount = 0; cart.freeShipping = false; cart.couponCode = null; }
    else {
      // Full authority AFTER mutation permits removing an expired accepted line.
      // Failure occurs before the update (and TTL refresh), in this SAME tx.
      try {
        if (cart.freeShipping) throw crossSellQuoteReviewRequired();
        if (cart.couponCode !== null) {
          if (!revalidateCoupon) throw crossSellQuoteReviewRequired();
          commercial = storefrontLocalCartCommercialOutcomeV1Schema.parse(await revalidateCoupon(tx, { merchantId, cartId: sessionId }, structuredClone(cart)));
          if (commercial.discountCents !== cart.discount || commercial.freeShipping !== false
            || commercial.quote.originalSubtotalCents !== cart.total) throw crossSellQuoteReviewRequired();
        } else commercial = await evaluateStorefrontCartCommercial(tx, { merchantId, cartId: sessionId }, cart);
        cart.discount = commercial.discountCents; cart.freeShipping = false;
      } catch (error) { rethrowStorefrontCommercialFailure(error); }
    }
  }
  const data = {
    items: cart.items as unknown as Prisma.InputJsonValue, total: cart.total, discount: cart.discount,
    couponCode: cart.couponCode, freeShipping: cart.freeShipping, expiresAt: new Date(Date.now() + 72 * 3600_000),
  };
  let saved: Awaited<ReturnType<typeof tx.storefrontCart.findUnique>>;
  if (releasedLegacyCoupon && legacyCouponBefore) {
    const changed = await tx.storefrontCart.updateMany({ where: { id: row.id, merchantId, sessionId,
      items: { equals: legacyCouponBefore.items as unknown as Prisma.InputJsonArray }, total: row.total, discount: row.discount,
      couponCode: row.couponCode, freeShipping: row.freeShipping, updatedAt: row.updatedAt }, data });
    if (changed.count !== 1) return legacyStorefrontCouponReleaseReview();
    saved = await tx.storefrontCart.findUnique({ where: { id: row.id } });
    if (!saved) return legacyStorefrontCouponReleaseReview();
  } else saved = await tx.storefrontCart.update({ where: { id: cart.id }, data });
  return { result, cart: { ...saved, items: saved.items as unknown as StorefrontCart["items"] }, ...(commercial ? { commercial } : {}) };
}

export function withStorefrontCart<T>(prisma: PrismaClient, merchantId: string, sessionId: string,
  work: StorefrontCartTransactionWork<T>, access?: "mutate"): Promise<StorefrontCartTransactionResult<T>>;
export function withStorefrontCart<T>(prisma: PrismaClient, merchantId: string, sessionId: string,
  work: StorefrontCartTransactionWork<T>, access: StorefrontCartAccess | undefined): Promise<StorefrontCartTransactionResult<T | void>>;
export async function withStorefrontCart<T>(prisma: PrismaClient, merchantId: string, sessionId: string,
  work: StorefrontCartTransactionWork<T>, access: StorefrontCartAccess = "mutate"): Promise<StorefrontCartTransactionResult<T | void>> {
  if (!merchantId?.trim() || !sessionId?.trim()) throw new BadRequestException("cart_scope_required");
  return prisma.$transaction(tx => withStorefrontCartInTransaction(tx, merchantId, sessionId, work, access),
    { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
}
