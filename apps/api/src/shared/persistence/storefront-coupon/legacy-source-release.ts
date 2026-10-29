import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { StorefrontCart } from "../../../modules/storefront/domain/ports/storefront-cart.port.js";
import { cancelUnboundStorefrontCouponReservation } from "./reservation-cancellation.js";

export function legacyStorefrontCouponReleaseReview(): never {
  throw new ConflictException({ code: "checkout_review_required", reason: "legacy_coupon_release_review_required",
    message: "Este cupom precisa de revisão antes de ser removido. Nenhum valor ou reserva foi alterado." });
}
function basis(cart: Pick<StorefrontCart, "items" | "total" | "couponCode" | "discount" | "freeShipping">) {
  return { items: cart.items, total: cart.total, couponCode: cart.couponCode, discount: cart.discount, freeShipping: cart.freeShipping };
}

/** Cancellation ONLY. Caller holds the common cart fence in ReadCommitted and
 * must CAS the source in this SAME transaction. Never acquire an earlier
 * merchant/checkout/payment lock, authorize a grant or retry an uncertain write.
 * The current API has no operation identity: this is not ABA/replay authority. */
export async function releaseLegacyStorefrontCouponSource(tx: Prisma.TransactionClient,
  scope: Readonly<{ merchantId: string; cartId: string }>, before: StorefrontCart, after: StorefrontCart): Promise<void> {
  if (before.merchantId !== scope.merchantId || before.sessionId !== scope.cartId
    || after.merchantId !== scope.merchantId || after.sessionId !== scope.cartId
    || !before.couponCode || !Number.isSafeInteger(before.discount) || before.discount <= 0 || before.discount > 2_147_483_647
    || before.freeShipping !== false || after.freeShipping !== false || after.discount !== 0
    || before.items.some(item => item.crossSellIntent !== undefined)
    || after.couponCode !== null && !(after.items.length === 0 && after.couponCode === before.couponCode)) return legacyStorefrontCouponReleaseReview();
  // Exact historical source, not a license to repair malformed monetary state.
  if (!before.items.length || !Number.isSafeInteger(before.total) || before.total < before.discount
    || before.items.some(item => !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)
    || before.items.reduce((sum, item) => sum + BigInt(item.unitPriceCents) * BigInt(item.quantity), 0n) !== BigInt(before.total)
    || after.items.length > 0 && !isDeepStrictEqual(after.items, before.items)) return legacyStorefrontCouponReleaseReview();
  // No binding does not prove an old cart_ref checkout/payment was resolved.
  // Conservatively preserve all such generations, without later-lock inversion.
  const checkouts = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM checkout_sessions
    WHERE merchant_id=${scope.merchantId} AND cart->>'cart_ref'=${scope.cartId} LIMIT 1`;
  if (checkouts.length !== 0) return legacyStorefrontCouponReleaseReview();
  const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
  if (!source || source.id !== before.id || source.merchantId !== scope.merchantId || source.sessionId !== scope.cartId
    || !isDeepStrictEqual(basis({ ...source, items: source.items as unknown as StorefrontCart["items"] }), basis(before))
    || source.updatedAt.getTime() !== before.updatedAt.getTime()) return legacyStorefrontCouponReleaseReview();
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM coupons
    WHERE merchant_id=${scope.merchantId} AND code=${before.couponCode} FOR UPDATE`;
  if (locked.length !== 1 || typeof locked[0]?.id !== "string" || !locked[0].id) return legacyStorefrontCouponReleaseReview();
  const coupon = await tx.coupon.findFirst({ where: { id: locked[0].id, merchantId: scope.merchantId, code: before.couponCode },
    select: { id: true, merchantId: true, code: true, discountType: true, strategyIncentiveExecutionId: true } });
  if (!coupon || coupon.id !== locked[0].id || coupon.merchantId !== scope.merchantId || coupon.code !== before.couponCode
    || !["fixed", "percent"].includes(coupon.discountType) || coupon.strategyIncentiveExecutionId !== null) return legacyStorefrontCouponReleaseReview();
  const reservations = await tx.couponRedemption.findMany({ where: { merchantId: scope.merchantId, sessionId: scope.cartId,
    status: { not: "cancelled" } }, take: 2 });
  if (reservations.length !== 1) return legacyStorefrontCouponReleaseReview();
  const reservation = reservations[0]!;
  if (reservation.merchantId !== scope.merchantId || reservation.sessionId !== scope.cartId || reservation.couponId !== coupon.id
    || reservation.status !== "applied" || reservation.orderId !== null
    || reservation.buyerGlobalUserId !== null && (typeof reservation.buyerGlobalUserId !== "string" || !reservation.buyerGlobalUserId)
    || !Prisma.Decimal.isDecimal(reservation.discountApplied) || !reservation.discountApplied.times(100).isInteger()
    || !reservation.discountApplied.times(100).eq(before.discount)) return legacyStorefrontCouponReleaseReview();
  await cancelUnboundStorefrontCouponReservation(tx, { merchantId: scope.merchantId, cartId: scope.cartId,
    couponId: coupon.id, redemptionId: reservation.id, reservationBuyerId: reservation.buyerGlobalUserId, discountCents: before.discount });
}
