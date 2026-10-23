import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Shared V1 applied->cancelled transition. Caller owns merchant/cart/coupon
 * fences, proves the actual unbound source and commits its source change in the
 * SAME transaction. Cancellation releases counted quota; never decrement usage.
 * This is not an issuer, source validator, idempotency receipt or public grant. */
export async function cancelUnboundStorefrontCouponReservation(tx: Prisma.TransactionClient, identity: Readonly<{
  merchantId: string; cartId: string; couponId: string; redemptionId: string;
  reservationBuyerId: string | null; discountCents: number;
}>): Promise<void> {
  const conflict = (): never => { throw new ConflictException("checkout_coupon_binding_conflict"); };
  const reservation = await tx.couponRedemption.findFirst({ where: { id: identity.redemptionId,
    merchantId: identity.merchantId, sessionId: identity.cartId, couponId: identity.couponId } });
  if (!reservation || reservation.id !== identity.redemptionId || reservation.merchantId !== identity.merchantId
    || reservation.sessionId !== identity.cartId || reservation.couponId !== identity.couponId
    || reservation.status !== "applied" || reservation.orderId !== null
    || reservation.buyerGlobalUserId !== identity.reservationBuyerId || !Number.isSafeInteger(identity.discountCents)
    || identity.discountCents <= 0 || !Prisma.Decimal.isDecimal(reservation.discountApplied)
    || !reservation.discountApplied.times(100).isInteger()
    || !reservation.discountApplied.times(100).eq(identity.discountCents)) return conflict();
  const changed = await tx.couponRedemption.updateMany({ where: { id: identity.redemptionId, merchantId: identity.merchantId,
    sessionId: identity.cartId, couponId: identity.couponId, buyerGlobalUserId: identity.reservationBuyerId,
    discountApplied: reservation.discountApplied, status: "applied", orderId: null }, data: { status: "cancelled" } });
  if (changed.count !== 1) return conflict();
}
