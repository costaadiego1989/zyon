import type { Prisma } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { hasStoredCheckoutCouponBinding } from "../../modules/checkout/domain/services/checkout-coupon-storage.js";
import { requireCheckoutBuyerIdentityReview } from "./checkout-buyer-identity-transition.js";

/** Shared negative boundary for identity commands, not a positive grant. Never
 * revoke, move, replace or silently discard any personal/financial owner. */
export async function assertNormalCheckoutIdentityHasNoPersonalOwner(tx: Prisma.TransactionClient,
  scope: { merchantId: string; sessionId: string }, stored: { cart: unknown; paymentMethod: string | null }, current: CheckoutSession): Promise<void> {
  if ((current.cart.currentDiscount ?? 0) !== 0 || current.cart.commercialNudge || current.cart.appliedBenefits?.length
    || hasStoredCheckoutCouponBinding(stored.cart) || current.cart.commerceCartRef || current.crossStoreItems?.length || stored.paymentMethod)
    return requireCheckoutBuyerIdentityReview();
  if (await tx.paymentIntent.findFirst({ where: scope, select: { id: true } })
    || await tx.completedOrder.findFirst({ where: scope, select: { id: true } })
    || await tx.couponRedemption.findFirst({ where: { merchantId: scope.merchantId,
      sessionId: { in: [scope.sessionId, ...(current.cart.cart_ref ? [current.cart.cart_ref] : [])] }, status: { not: "cancelled" } }, select: { id: true } })
    || await tx.acceptedOffer.findFirst({ where: scope, select: { id: true } })
    || await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } })
    || await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } })
    || await tx.strategyIncentiveReservation.findFirst({ where: { ...scope, status: { in: ["reserved", "spent"] } }, select: { id: true } }))
    return requireCheckoutBuyerIdentityReview();
}
