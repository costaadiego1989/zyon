import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { StorefrontCart } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { storefrontCartLineSelectorSchema } from "../../../storefront/domain/contracts/storefront-cart-line-selector.schemas.js";
import { selectStorefrontCartLine } from "../../../storefront/domain/services/storefront-cart-line-identity.js";
import { PrismaStorefrontCartUnitOfWork } from "../../../storefront/infrastructure/repositories/prisma-storefront-cart-unit-of-work.js";
import { lockCrossSellMerchantAuthority } from "../../../storefront/infrastructure/repositories/storefront-cross-sell-authority-fence.js";
import { combinedCouponReviewRequired, readCombinedStorefrontCouponCommercial } from "../../../../shared/persistence/storefront-coupon/combined-merchandise.js";
import { cancelUnboundStorefrontCouponReservation } from "../../../../shared/persistence/storefront-coupon/reservation-cancellation.js";

const reference = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const identity = { operationId: z.uuid(), expectedCouponCode: reference };
export const combinedCouponLifecycleRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...identity, action: z.literal("remove_coupon") }),
  z.strictObject({ ...identity, action: z.literal("clear") }),
  z.strictObject({ ...identity, action: z.literal("remove_coupon_and_item"), variantId: reference,
    selector: storefrontCartLineSelectorSchema.optional() }),
]);
const resultSchema = z.strictObject({ kind: z.literal("lifecycle_recorded"), operationId: z.uuid(),
  couponReleased: z.literal(true), itemCount: z.number().int().min(0).max(200), totalCents: z.number().int().min(0).max(2_147_483_647) });
const eventType = "storefront.coupon.lifecycle-recorded", producer = "storefront-coupon-lifecycle";
const receiptSchema = z.strictObject({ eventId: reference, merchantId: reference,
  eventType: z.literal(eventType), producer: z.literal(producer), schemaVersion: z.literal(1), status: z.literal("recorded"), payload: z.strictObject({
    version: z.literal(1), merchantId: reference, cartId: reference, operationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    couponId: reference, redemptionId: reference, discountCents: z.number().int().positive().max(2_147_483_647), result: resultSchema,
  }) });
const receiptSelect = { eventId: true, merchantId: true, eventType: true, producer: true, schemaVersion: true, status: true, payload: true } as const;
type Scope = Readonly<{ merchantId: string; cartId: string; trustedBuyerGlobalUserId?: string }>;
export type CombinedCouponLifecycleRequest = z.input<typeof combinedCouponLifecycleRequestSchema>;
function basis(cart: StorefrontCart) {
  return { items: cart.items, total: cart.total, discount: cart.discount, couponCode: cart.couponCode, freeShipping: cart.freeShipping };
}

/** Internal explicit release. Uses the existing V1 cancellation CAS and bound
 * cart operations. The technical receipt is a historical result only, not a
 * current quote, issuer, admission or permission to replay a mutation. */
export async function mutateStorefrontCombinedCoupon(prisma: PrismaClient, parsedScope: Scope, rawInput: CombinedCouponLifecycleRequest) {
  const scope = { ...parsedScope }, request = combinedCouponLifecycleRequestSchema.parse(rawInput);
  const cartScope = { merchantId: scope.merchantId, cartId: scope.cartId };
  if (request.action === "remove_coupon_and_item" && request.selector?.optionItemIds) request.selector.optionItemIds.sort();
  const fingerprint = createHash("sha256").update(JSON.stringify([scope.merchantId, scope.cartId,
    scope.trustedBuyerGlobalUserId ?? null, request])).digest("hex");
  const eventId = "evt_storefront_coupon_lifecycle_" + createHash("sha256").update(JSON.stringify([
    scope.merchantId, scope.cartId, request.operationId,
  ])).digest("hex");
  let released: { couponId: string; redemptionId: string; discountCents: number } | undefined;
  return new PrismaStorefrontCartUnitOfWork(prisma).run(cartScope, async ({ tx, cart: bound }) => {
    const existing = await tx.outboxMessage.findFirst({ where: { eventId, merchantId: scope.merchantId }, select: receiptSelect });
    if (existing) {
      const receipt = receiptSchema.parse(existing);
      if (receipt.eventId !== eventId || receipt.merchantId !== scope.merchantId || receipt.payload.merchantId !== scope.merchantId
        || receipt.payload.cartId !== scope.cartId || receipt.payload.operationId !== request.operationId
        || receipt.payload.fingerprint !== fingerprint || receipt.payload.result.operationId !== request.operationId) return combinedCouponReviewRequired();
      return receipt.payload.result;
    }
    const stored = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
    if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.cartId
      || stored.couponCode !== request.expectedCouponCode || !Array.isArray(stored.items)) return combinedCouponReviewRequired();
    const source: StorefrontCart = { ...stored, items: stored.items as unknown as StorefrontCart["items"] };
    if (request.action === "remove_coupon_and_item" && selectStorefrontCartLine(source.items, request.variantId, request.selector) === undefined) return combinedCouponReviewRequired();
    // Only the actual before source can authorize lifecycle. A changed/expired
    // catalog requires review rather than silently losing the accepted benefit.
    await readCombinedStorefrontCouponCommercial(tx, cartScope, source, scope.trustedBuyerGlobalUserId);
    let saved: StorefrontCart;
    if (request.action === "clear") saved = await bound.clear(scope.merchantId, scope.cartId);
    else {
      saved = await bound.removeCoupon(scope.merchantId, scope.cartId);
      if (request.action === "remove_coupon_and_item") saved = await bound.removeItem(scope.merchantId, scope.cartId, request.variantId, request.selector);
    }
    if (!released || saved.couponCode !== null || saved.discount !== 0 || saved.freeShipping !== false) return combinedCouponReviewRequired();
    const result = resultSchema.parse({ kind: "lifecycle_recorded", operationId: request.operationId,
      couponReleased: true, itemCount: saved.items.length, totalCents: saved.total });
    const payload = { version: 1 as const, merchantId: scope.merchantId, cartId: scope.cartId,
      operationId: request.operationId, fingerprint, ...released, result };
    const clock = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0]!.now;
    await tx.outboxMessage.upsert({ where: { eventId }, create: { eventId, eventType, producer, schemaVersion: 1, status: "recorded",
      merchantId: scope.merchantId, occurredAt: clock, correlationId: eventId, causationId: request.operationId,
      payload: payload as Prisma.InputJsonValue }, update: {} });
    const written = receiptSchema.parse(await tx.outboxMessage.findFirst({ where: { eventId, merchantId: scope.merchantId }, select: receiptSelect }));
    if (!isDeepStrictEqual(written.payload, payload)) return combinedCouponReviewRequired();
    return result;
  }, {
    beforeCartLock: tx => lockCrossSellMerchantAuthority(tx, scope.merchantId),
    revalidateCoupon: (tx, lockedScope, cart) => readCombinedStorefrontCouponCommercial(tx, lockedScope, cart, scope.trustedBuyerGlobalUserId),
    couponLifecycle: async (tx, lockedScope, before, after) => {
      if (released || lockedScope.merchantId !== scope.merchantId || lockedScope.cartId !== scope.cartId
        || before.couponCode !== request.expectedCouponCode || after.couponCode !== null || after.discount !== 0 || after.freeShipping !== false
        || (request.action === "clear" ? after.items.length !== 0 : !isDeepStrictEqual(after.items, before.items))) return combinedCouponReviewRequired();
      const actual = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
      if (!actual || !isDeepStrictEqual(basis(before), basis({ ...actual, items: actual.items as unknown as StorefrontCart["items"] }))) return combinedCouponReviewRequired();
      await readCombinedStorefrontCouponCommercial(tx, lockedScope, before, scope.trustedBuyerGlobalUserId);
      const reservations = await tx.couponRedemption.findMany({ where: { merchantId: scope.merchantId, sessionId: scope.cartId,
        status: { not: "cancelled" } }, take: 2 });
      if (reservations.length !== 1) return combinedCouponReviewRequired();
      const row = reservations[0]!;
      await cancelUnboundStorefrontCouponReservation(tx, { merchantId: scope.merchantId, cartId: scope.cartId,
        couponId: row.couponId, redemptionId: row.id, reservationBuyerId: row.buyerGlobalUserId, discountCents: before.discount });
      released = { couponId: row.couponId, redemptionId: row.id, discountCents: before.discount };
    },
  });
}
