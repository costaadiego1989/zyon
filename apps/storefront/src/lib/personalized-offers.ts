import type { BuyerPersonalizedOffer } from "./viewmodels/useBuyerHub/types";

/** Never infer eligibility, a discount amount, or a checkout from public coupons. */
export function currentPersonalizedOffers(offers: unknown, now = Date.now(), sessionId?: string): BuyerPersonalizedOffer[] {
  if (!Array.isArray(offers)) return [];
  return offers.filter((offer): offer is BuyerPersonalizedOffer => {
    if (!offer || typeof offer !== "object" || offer.status !== "applied" || offer.currency !== "BRL") return false;
    if (!["percentage", "fixed", "shipping", "progressive"].includes(offer.kind)) return false;
    if (typeof offer.id !== "string" || !offer.id || typeof offer.sessionId !== "string" || !offer.sessionId) return false;
    if (sessionId !== undefined && offer.sessionId !== sessionId) return false;
    if (!Number.isSafeInteger(offer.amountCents) || offer.amountCents <= 0 || !Number.isSafeInteger(offer.maxDiscountCents)
      || offer.maxDiscountCents < offer.amountCents || !Number.isFinite(offer.discountPercent)
      || offer.discountPercent <= 0 || offer.discountPercent > 100) return false;
    if (typeof offer.expiresAt !== "string" || !(Date.parse(offer.expiresAt) > now)) return false;
    if (offer.deliveryMode !== "automatic" && offer.deliveryMode !== "coupon_code") return false;
    if (offer.deliveryMode === "coupon_code" && (typeof offer.couponCode !== "string" || !offer.couponCode.trim())) return false;
    return typeof offer.condition === "string";
  });
}
